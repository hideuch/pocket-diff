package gitdiff

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const maxUntrackedBytes = 1024 * 1024
const maxPreviewBytes = 25 * 1024 * 1024

type Summary struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
	Files     int `json:"files"`
}

type Result struct {
	Repo        string   `json:"repo"`
	Branch      string   `json:"branch"`
	Base        string   `json:"base"`
	Patch       string   `json:"patch"`
	Revision    string   `json:"revision"`
	Summary     Summary  `json:"summary"`
	Skipped     []string `json:"skipped"`
	GeneratedAt string   `json:"generatedAt"`
}

type CommandError struct {
	Command string
	Stderr  string
	Err     error
}

func (e *CommandError) Error() string {
	if strings.TrimSpace(e.Stderr) != "" {
		return strings.TrimSpace(e.Stderr)
	}
	return fmt.Sprintf("%s: %v", e.Command, e.Err)
}

func runGit(directory string, allowDifference bool, args ...string) (string, error) {
	command := exec.Command("git", args...)
	command.Dir = directory
	command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1")
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	if err == nil {
		return stdout.String(), nil
	}
	var exitError *exec.ExitError
	if allowDifference && errors.As(err, &exitError) && exitError.ExitCode() == 1 {
		return stdout.String(), nil
	}
	return "", &CommandError{Command: "git " + strings.Join(args, " "), Stderr: stderr.String(), Err: err}
}

// ReadFileVersion returns a repository file for the image preview endpoint.
// source must be either "working" or "head". Working-tree symlinks are
// resolved and rejected when they point outside of the repository.
func ReadFileVersion(repositoryPath, name, source string) ([]byte, error) {
	cleanName := filepath.ToSlash(filepath.Clean(filepath.FromSlash(name)))
	if name == "" || cleanName == "." || cleanName == ".." || strings.HasPrefix(cleanName, "../") || filepath.IsAbs(name) {
		return nil, fmt.Errorf("invalid repository path")
	}

	rootOutput, err := runGit(repositoryPath, false, "rev-parse", "--show-toplevel")
	if err != nil {
		return nil, err
	}
	root, err := filepath.EvalSymlinks(strings.TrimSpace(rootOutput))
	if err != nil {
		return nil, err
	}

	switch source {
	case "working":
		candidate, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(cleanName)))
		if err != nil {
			return nil, err
		}
		relative, err := filepath.Rel(root, candidate)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
			return nil, fmt.Errorf("file is outside the repository")
		}
		info, err := os.Stat(candidate)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("not a regular file")
		}
		if info.Size() > maxPreviewBytes {
			return nil, fmt.Errorf("file exceeds the preview limit")
		}
		return os.ReadFile(candidate)
	case "head":
		spec := "HEAD:" + cleanName
		sizeOutput, err := runGit(root, false, "cat-file", "-s", spec)
		if err != nil {
			return nil, err
		}
		var size int64
		if _, err := fmt.Sscan(strings.TrimSpace(sizeOutput), &size); err != nil || size > maxPreviewBytes {
			return nil, fmt.Errorf("file exceeds the preview limit")
		}
		content, err := runGit(root, false, "show", spec)
		return []byte(content), err
	default:
		return nil, fmt.Errorf("invalid file source")
	}
}

func CountPatch(patch string) Summary {
	var summary Summary
	for _, line := range strings.Split(patch, "\n") {
		switch {
		case strings.HasPrefix(line, "diff --git "):
			summary.Files++
		case strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++"):
			summary.Additions++
		case strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---"):
			summary.Deletions++
		}
	}
	return summary
}

func hasHead(root string) bool {
	_, err := runGit(root, false, "rev-parse", "--verify", "HEAD")
	return err == nil
}

func untrackedPatch(root string) (string, []string, error) {
	raw, err := runGit(root, false, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return "", nil, err
	}
	var patches, skipped []string
	for _, name := range strings.Split(raw, "\x00") {
		if name == "" {
			continue
		}
		absolute := filepath.Join(root, filepath.FromSlash(name))
		relative, err := filepath.Rel(root, absolute)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
			continue
		}
		info, err := os.Stat(absolute)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		if info.Size() > maxUntrackedBytes {
			skipped = append(skipped, name)
			continue
		}
		content, err := os.ReadFile(absolute)
		if err != nil {
			return "", nil, err
		}
		if bytes.IndexByte(content, 0) >= 0 {
			patches = append(patches, fmt.Sprintf("diff --git a/%s b/%s\nnew file mode 100644\nBinary files /dev/null and b/%s differ\n", name, name, name))
			continue
		}
		patch, err := runGit(root, true, "diff", "--no-index", "--no-ext-diff", "--no-color", "--", "/dev/null", name)
		if err != nil {
			return "", nil, err
		}
		if patch != "" {
			patches = append(patches, patch)
		}
	}
	return strings.Join(patches, "\n"), skipped, nil
}

func Collect(repositoryPath string) (Result, error) {
	rootOutput, err := runGit(repositoryPath, false, "rev-parse", "--show-toplevel")
	if err != nil {
		return Result{}, err
	}
	root := strings.TrimSpace(rootOutput)
	branch, err := runGit(root, false, "branch", "--show-current")
	if err != nil {
		return Result{}, err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "detached HEAD"
	}

	headExists := hasHead(root)
	tracked := ""
	base := "empty repository"
	if headExists {
		base = "HEAD"
		tracked, err = runGit(root, false, "diff", "--no-ext-diff", "--no-color", "--find-renames", "--unified=3", "HEAD", "--")
	} else {
		var staged, unstaged string
		staged, err = runGit(root, false, "diff", "--cached", "--no-ext-diff", "--no-color", "--unified=3", "--")
		if err == nil {
			unstaged, err = runGit(root, false, "diff", "--no-ext-diff", "--no-color", "--unified=3", "--")
		}
		tracked = strings.TrimSpace(staged + "\n" + unstaged)
	}
	if err != nil {
		return Result{}, err
	}
	untracked, skipped, err := untrackedPatch(root)
	if err != nil {
		return Result{}, err
	}
	patch := strings.Join(nonempty(tracked, untracked), "\n")
	hash := sha256.Sum256([]byte(patch))
	return Result{
		Repo: filepath.Base(root), Branch: branch, Base: base, Patch: patch,
		Revision: hex.EncodeToString(hash[:])[:16], Summary: CountPatch(patch),
		Skipped: skipped, GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func nonempty(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

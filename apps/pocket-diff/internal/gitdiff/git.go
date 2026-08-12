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
	Repo           string       `json:"repo"`
	Branch         string       `json:"branch"`
	Base           string       `json:"base"`
	Patch          string       `json:"patch"`
	Revision       string       `json:"revision"`
	StatusRevision string       `json:"statusRevision"`
	ChangeToken    string       `json:"changeToken"`
	Summary        Summary      `json:"summary"`
	FilesStatus    []FileStatus `json:"filesStatus"`
	Skipped        []string     `json:"skipped"`
	GeneratedAt    string       `json:"generatedAt"`
}

type StatusResult struct {
	FilesStatus    []FileStatus `json:"filesStatus"`
	StatusRevision string       `json:"statusRevision"`
	ChangeToken    string       `json:"changeToken"`
}

type FileStatus struct {
	Path         string `json:"path"`
	PreviousPath string `json:"previousPath,omitempty"`
	Stage        string `json:"stage"`
	Kind         string `json:"kind"`
}

type statusEntry struct {
	FileStatus
	IndexCode    byte
	WorktreeCode byte
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

// IsChangedFile reports whether name is currently part of the repository's
// working-tree changes. It keeps preview endpoints from becoming arbitrary
// repository file readers when their query parameters are edited directly.
func IsChangedFile(repositoryPath, name string) bool {
	cleanName, err := cleanRepositoryPath(name)
	if err != nil {
		return false
	}
	status, err := runGit(repositoryPath, false, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", literalPathspec(cleanName))
	return err == nil && status != ""
}

func cleanRepositoryPath(name string) (string, error) {
	cleanName := filepath.ToSlash(filepath.Clean(filepath.FromSlash(name)))
	if name == "" || cleanName == "." || cleanName == ".." || strings.HasPrefix(cleanName, "../") || filepath.IsAbs(name) {
		return "", fmt.Errorf("invalid repository path")
	}
	return cleanName, nil
}

func literalPathspec(name string) string {
	return ":(literal)" + name
}

func repositoryRoot(repositoryPath string) (string, error) {
	rootOutput, err := runGit(repositoryPath, false, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(rootOutput), nil
}

func collectStatus(root string) ([]statusEntry, string, error) {
	raw, err := runGit(root, false, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return nil, "", err
	}
	parts := strings.Split(raw, "\x00")
	entries := make([]statusEntry, 0, len(parts))
	for index := 0; index < len(parts); index++ {
		entry := parts[index]
		if len(entry) < 4 {
			continue
		}
		indexCode, worktreeCode := entry[0], entry[1]
		name := entry[3:]
		previousName := ""
		if indexCode == 'R' || indexCode == 'C' || worktreeCode == 'R' || worktreeCode == 'C' {
			if index+1 < len(parts) {
				index++
				previousName = parts[index]
			}
		}
		stage := "unstaged"
		hasStaged := indexCode != ' ' && indexCode != '?'
		hasUnstaged := worktreeCode != ' ' && worktreeCode != '?'
		if hasStaged && hasUnstaged {
			stage = "partial"
		} else if hasStaged {
			stage = "staged"
		}
		kind := "modified"
		switch {
		case indexCode == '?' && worktreeCode == '?':
			kind = "untracked"
		case indexCode == 'R' || worktreeCode == 'R':
			kind = "renamed"
		case indexCode == 'A' || worktreeCode == 'A':
			kind = "added"
		case indexCode == 'D' || worktreeCode == 'D':
			kind = "deleted"
		}
		entries = append(entries, statusEntry{
			FileStatus: FileStatus{Path: name, PreviousPath: previousName, Stage: stage, Kind: kind},
			IndexCode:  indexCode, WorktreeCode: worktreeCode,
		})
	}
	return entries, raw, nil
}

func Snapshot(repositoryPath string) (StatusResult, error) {
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return StatusResult{}, err
	}
	return snapshotRoot(root)
}

func snapshotRoot(root string) (StatusResult, error) {
	entries, rawStatus, err := collectStatus(root)
	if err != nil {
		return StatusResult{}, err
	}
	filesStatus := make([]FileStatus, 0, len(entries))
	var contentState strings.Builder
	head, _ := runGit(root, false, "rev-parse", "--verify", "HEAD")
	contentState.WriteString(strings.TrimSpace(head))
	contentState.WriteByte(0)
	for _, entry := range entries {
		filesStatus = append(filesStatus, entry.FileStatus)
		fmt.Fprintf(&contentState, "%s\x00%s\x00%s\x00", entry.Path, entry.PreviousPath, entry.Kind)
		appendFileState(&contentState, root, entry.Path)
		if entry.PreviousPath != "" {
			appendFileState(&contentState, root, entry.PreviousPath)
		}
	}
	statusHash := sha256.Sum256([]byte(rawStatus))
	contentHash := sha256.Sum256([]byte(contentState.String()))
	return StatusResult{
		FilesStatus:    filesStatus,
		StatusRevision: hex.EncodeToString(statusHash[:])[:16],
		ChangeToken:    hex.EncodeToString(contentHash[:])[:16],
	}, nil
}

func appendFileState(builder *strings.Builder, root, name string) {
	if name == "" {
		return
	}
	info, err := os.Lstat(filepath.Join(root, filepath.FromSlash(name)))
	if err != nil {
		fmt.Fprintf(builder, "missing:%s\x00", name)
		return
	}
	fmt.Fprintf(builder, "%s:%d:%d:%d\x00", name, info.Size(), info.ModTime().UnixNano(), info.Mode())
}

func Stage(repositoryPath, name string) error {
	cleanName, err := cleanRepositoryPath(name)
	if err != nil {
		return err
	}
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return err
	}
	entries, _, err := collectStatus(root)
	if err != nil {
		return err
	}
	entry, ok := findStatusEntry(entries, cleanName)
	if !ok {
		return fmt.Errorf("file is not part of the working tree changes")
	}
	paths := []string{literalPathspec(entry.Path)}
	if entry.PreviousPath != "" {
		paths = append(paths, literalPathspec(entry.PreviousPath))
	}
	_, err = runGit(root, false, append([]string{"add", "--"}, paths...)...)
	return err
}

func StageAll(repositoryPath string) error {
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return err
	}
	_, err = runGit(root, false, "add", "-A", "--", ".")
	return err
}

func Unstage(repositoryPath, name string) error {
	cleanName, err := cleanRepositoryPath(name)
	if err != nil {
		return err
	}
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return err
	}
	entries, _, err := collectStatus(root)
	if err != nil {
		return err
	}
	entry, ok := findStatusEntry(entries, cleanName)
	if !ok || entry.IndexCode == ' ' || entry.IndexCode == '?' {
		return fmt.Errorf("file has no staged changes")
	}
	paths := []string{literalPathspec(entry.Path)}
	if entry.PreviousPath != "" {
		paths = append(paths, literalPathspec(entry.PreviousPath))
	}
	if hasHead(root) {
		_, err = runGit(root, false, append([]string{"restore", "--staged", "--"}, paths...)...)
		return err
	}
	_, err = runGit(root, false, append([]string{"rm", "--cached", "-f", "--ignore-unmatch", "--"}, paths...)...)
	return err
}

func UnstageAll(repositoryPath string) error {
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return err
	}
	if hasHead(root) {
		_, err = runGit(root, false, "restore", "--staged", "--", ".")
		return err
	}
	_, err = runGit(root, false, "rm", "--cached", "-r", "-f", "--ignore-unmatch", "--", ".")
	return err
}

func Discard(repositoryPath, name string) error {
	cleanName, err := cleanRepositoryPath(name)
	if err != nil {
		return err
	}
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return err
	}
	entries, _, err := collectStatus(root)
	if err != nil {
		return err
	}
	entry, ok := findStatusEntry(entries, cleanName)
	if !ok {
		return fmt.Errorf("file is not part of the working tree changes")
	}
	if entry.IndexCode == '?' && entry.WorktreeCode == '?' {
		return removeUntracked(root, entry.Path)
	}
	paths := []string{literalPathspec(entry.Path)}
	if entry.PreviousPath != "" {
		paths = append(paths, literalPathspec(entry.PreviousPath))
	}
	if !hasHead(root) {
		if _, err := runGit(root, false, append([]string{"rm", "--cached", "-f", "--ignore-unmatch", "--"}, paths...)...); err != nil {
			return err
		}
		if err := removeUntracked(root, entry.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	_, err = runGit(root, false, append([]string{"restore", "--source=HEAD", "--staged", "--worktree", "--"}, paths...)...)
	return err
}

func Commit(repositoryPath, message string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		return fmt.Errorf("commit message is required")
	}
	if len(message) > 4096 {
		return fmt.Errorf("commit message is too long")
	}
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return err
	}
	entries, _, err := collectStatus(root)
	if err != nil {
		return err
	}
	hasStaged := false
	for _, entry := range entries {
		if entry.IndexCode != ' ' && entry.IndexCode != '?' {
			hasStaged = true
			break
		}
	}
	if !hasStaged {
		return fmt.Errorf("there are no staged changes")
	}
	_, err = runGit(root, false, "commit", "-m", message)
	return err
}

func findStatusEntry(entries []statusEntry, name string) (statusEntry, bool) {
	for _, entry := range entries {
		if entry.Path == name || entry.PreviousPath == name {
			return entry, true
		}
	}
	return statusEntry{}, false
}

func removeUntracked(root, name string) error {
	cleanName, err := cleanRepositoryPath(name)
	if err != nil {
		return err
	}
	candidate := filepath.Join(root, filepath.FromSlash(cleanName))
	relative, err := filepath.Rel(root, candidate)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return fmt.Errorf("file is outside the repository")
	}
	info, err := os.Lstat(candidate)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0 {
		return fmt.Errorf("only files can be discarded")
	}
	return os.Remove(candidate)
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
	root, err := repositoryRoot(repositoryPath)
	if err != nil {
		return Result{}, err
	}
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
	snapshot, err := snapshotRoot(root)
	if err != nil {
		return Result{}, err
	}
	hash := sha256.Sum256([]byte(patch))
	return Result{
		Repo: filepath.Base(root), Branch: branch, Base: base, Patch: patch,
		Revision: hex.EncodeToString(hash[:])[:16], StatusRevision: snapshot.StatusRevision,
		ChangeToken: snapshot.ChangeToken, Summary: CountPatch(patch), FilesStatus: snapshot.FilesStatus,
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

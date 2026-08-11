package gitdiff

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"testing"
)

func TestCountPatch(t *testing.T) {
	patch := "diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n"
	summary := CountPatch(patch)
	if summary != (Summary{Files: 1, Additions: 1, Deletions: 1}) {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func TestCollectIncludesTrackedAndUntrackedChanges(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "tracked.js"), "const value = 1;\n")
	gitTest(t, repository, "add", "tracked.js")
	gitTest(t, repository, "commit", "-qm", "initial")
	writeTestFile(t, filepath.Join(repository, "tracked.js"), "const value = 2;\n")
	writeTestFile(t, filepath.Join(repository, "new.js"), "export const ready = true;\n")

	result, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary != (Summary{Files: 2, Additions: 2, Deletions: 1}) {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	for _, expected := range []string{"diff --git a/tracked.js b/tracked.js", "diff --git a/new.js b/new.js"} {
		if !regexp.MustCompile(regexp.QuoteMeta(expected)).MatchString(result.Patch) {
			t.Fatalf("patch does not contain %q", expected)
		}
	}
	if !regexp.MustCompile(`^[a-f0-9]{16}$`).MatchString(result.Revision) {
		t.Fatalf("invalid revision: %s", result.Revision)
	}
}

func TestReadFileVersionReadsWorkingTreeAndHead(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "preview.png"), "head-image")
	gitTest(t, repository, "add", "preview.png")
	gitTest(t, repository, "commit", "-qm", "initial")
	writeTestFile(t, filepath.Join(repository, "preview.png"), "working-image")

	working, err := ReadFileVersion(repository, "preview.png", "working")
	if err != nil || string(working) != "working-image" {
		t.Fatalf("unexpected working file: %q, %v", working, err)
	}
	head, err := ReadFileVersion(repository, "preview.png", "head")
	if err != nil || string(head) != "head-image" {
		t.Fatalf("unexpected HEAD file: %q, %v", head, err)
	}
}

func TestReadFileVersionRejectsPathsOutsideRepository(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	outside := filepath.Join(t.TempDir(), "outside.png")
	writeTestFile(t, outside, "private")

	if _, err := ReadFileVersion(repository, "../outside.png", "working"); err == nil {
		t.Fatal("parent traversal was accepted")
	}
	if err := os.Symlink(outside, filepath.Join(repository, "linked.png")); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadFileVersion(repository, "linked.png", "working"); err == nil {
		t.Fatal("symlink outside repository was accepted")
	}
}

func gitTest(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", arguments...)
	command.Dir = directory
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", arguments, err, output)
	}
}

func writeTestFile(t *testing.T, filename, content string) {
	t.Helper()
	if err := os.WriteFile(filename, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

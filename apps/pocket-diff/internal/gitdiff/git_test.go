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

func TestStageTracksStageStateAndCommit(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "before\n")
	gitTest(t, repository, "add", "tracked.txt")
	gitTest(t, repository, "commit", "-qm", "initial")
	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "staged\n")

	before, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	if status := findFileStatus(t, before, "tracked.txt"); status.Stage != "unstaged" {
		t.Fatalf("unexpected initial stage state: %+v", status)
	}
	if err := Stage(repository, "tracked.txt"); err != nil {
		t.Fatal(err)
	}
	staged, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	if staged.Revision != before.Revision {
		t.Fatal("staging changed the content revision")
	}
	if staged.StatusRevision == before.StatusRevision {
		t.Fatal("staging did not change the status revision")
	}
	if staged.ChangeToken != before.ChangeToken {
		t.Fatal("staging changed the working-tree token")
	}
	if status := findFileStatus(t, staged, "tracked.txt"); status.Stage != "staged" {
		t.Fatalf("file was not staged: %+v", status)
	}
	if err := Unstage(repository, "tracked.txt"); err != nil {
		t.Fatal(err)
	}
	unstaged, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	if unstaged.Revision != staged.Revision {
		t.Fatal("unstaging changed the content revision")
	}
	if unstaged.StatusRevision == staged.StatusRevision {
		t.Fatal("unstaging did not change the status revision")
	}
	if status := findFileStatus(t, unstaged, "tracked.txt"); status.Stage != "unstaged" {
		t.Fatalf("file was not unstaged: %+v", status)
	}
	if err := Stage(repository, "tracked.txt"); err != nil {
		t.Fatal(err)
	}

	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "staged and working\n")
	partial, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	if status := findFileStatus(t, partial, "tracked.txt"); status.Stage != "partial" {
		t.Fatalf("partial state was not reported: %+v", status)
	}
	if err := Stage(repository, "tracked.txt"); err != nil {
		t.Fatal(err)
	}
	if err := Commit(repository, "Update tracked file"); err != nil {
		t.Fatal(err)
	}
	clean, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	if len(clean.FilesStatus) != 0 || clean.Patch != "" {
		t.Fatalf("repository was not clean after commit: %+v", clean.FilesStatus)
	}
	message := gitTestOutput(t, repository, "log", "-1", "--pretty=%s")
	if message != "Update tracked file\n" {
		t.Fatalf("unexpected commit message: %q", message)
	}
}

func TestSnapshotDetectsWorkingTreeContentChanges(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "before\n")
	gitTest(t, repository, "add", "tracked.txt")
	gitTest(t, repository, "commit", "-qm", "initial")
	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "first change\n")

	before, err := Snapshot(repository)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "a longer second change\n")
	after, err := Snapshot(repository)
	if err != nil {
		t.Fatal(err)
	}
	if after.ChangeToken == before.ChangeToken {
		t.Fatal("working-tree content change was not detected")
	}
}

func TestStageAllAndUnstageAll(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "before\n")
	gitTest(t, repository, "add", "tracked.txt")
	gitTest(t, repository, "commit", "-qm", "initial")
	writeTestFile(t, filepath.Join(repository, "tracked.txt"), "after\n")
	writeTestFile(t, filepath.Join(repository, "new.txt"), "new\n")

	if err := StageAll(repository); err != nil {
		t.Fatal(err)
	}
	staged, err := Snapshot(repository)
	if err != nil {
		t.Fatal(err)
	}
	if len(staged.FilesStatus) != 2 {
		t.Fatalf("unexpected staged files: %+v", staged.FilesStatus)
	}
	for _, status := range staged.FilesStatus {
		if status.Stage != "staged" {
			t.Fatalf("file was not staged: %+v", status)
		}
	}

	if err := UnstageAll(repository); err != nil {
		t.Fatal(err)
	}
	unstaged, err := Snapshot(repository)
	if err != nil {
		t.Fatal(err)
	}
	if len(unstaged.FilesStatus) != 2 {
		t.Fatalf("unexpected unstaged files: %+v", unstaged.FilesStatus)
	}
	for _, status := range unstaged.FilesStatus {
		if status.Stage != "unstaged" {
			t.Fatalf("file was not unstaged: %+v", status)
		}
	}
}

func TestUnstageWorksBeforeFirstCommit(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	writeTestFile(t, filepath.Join(repository, "first.txt"), "first\n")
	if err := Stage(repository, "first.txt"); err != nil {
		t.Fatal(err)
	}
	if err := Unstage(repository, "first.txt"); err != nil {
		t.Fatal(err)
	}
	result, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	status := findFileStatus(t, result, "first.txt")
	if status.Stage != "unstaged" || status.Kind != "untracked" {
		t.Fatalf("unexpected status after unstaging initial file: %+v", status)
	}
	if _, err := os.Stat(filepath.Join(repository, "first.txt")); err != nil {
		t.Fatalf("unstaging removed the working file: %v", err)
	}
}

func TestDiscardRestoresRenameAndRemovesUntrackedFile(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "old.txt"), "original\n")
	gitTest(t, repository, "add", "old.txt")
	gitTest(t, repository, "commit", "-qm", "initial")
	gitTest(t, repository, "mv", "old.txt", "new.txt")
	writeTestFile(t, filepath.Join(repository, "untracked.txt"), "temporary\n")

	result, err := Collect(repository)
	if err != nil {
		t.Fatal(err)
	}
	rename := findFileStatus(t, result, "new.txt")
	if rename.Kind != "renamed" || rename.PreviousPath != "old.txt" {
		t.Fatalf("unexpected rename status: %+v", rename)
	}
	if err := Discard(repository, "new.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(repository, "old.txt")); err != nil {
		t.Fatalf("original path was not restored: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repository, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("renamed path still exists: %v", err)
	}
	if err := Discard(repository, "untracked.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(repository, "untracked.txt")); !os.IsNotExist(err) {
		t.Fatalf("untracked file still exists: %v", err)
	}
}

func TestDiscardRemovesStagedNewFile(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "base.txt"), "base\n")
	gitTest(t, repository, "add", "base.txt")
	gitTest(t, repository, "commit", "-qm", "initial")
	writeTestFile(t, filepath.Join(repository, "new.txt"), "new\n")
	if err := Stage(repository, "new.txt"); err != nil {
		t.Fatal(err)
	}
	if err := Discard(repository, "new.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(repository, "new.txt")); !os.IsNotExist(err) {
		t.Fatalf("staged new file still exists: %v", err)
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

func TestIsChangedFileOnlyAcceptsWorkingTreeChanges(t *testing.T) {
	repository := t.TempDir()
	gitTest(t, repository, "init", "-q")
	gitTest(t, repository, "config", "user.name", "Pocket Diff Test")
	gitTest(t, repository, "config", "user.email", "test@example.invalid")
	writeTestFile(t, filepath.Join(repository, "changed.txt"), "before\n")
	writeTestFile(t, filepath.Join(repository, "unchanged.txt"), "private\n")
	writeTestFile(t, filepath.Join(repository, "renamed.txt"), "rename me\n")
	writeTestFile(t, filepath.Join(repository, "deleted.txt"), "delete me\n")
	gitTest(t, repository, "add", ".")
	gitTest(t, repository, "commit", "-qm", "initial")
	writeTestFile(t, filepath.Join(repository, "changed.txt"), "after\n")
	gitTest(t, repository, "mv", "renamed.txt", "moved.txt")
	if err := os.Remove(filepath.Join(repository, "deleted.txt")); err != nil {
		t.Fatal(err)
	}

	if !IsChangedFile(repository, "changed.txt") {
		t.Fatal("changed file was rejected")
	}
	if IsChangedFile(repository, "unchanged.txt") {
		t.Fatal("unchanged file was accepted")
	}
	if !IsChangedFile(repository, "moved.txt") {
		t.Fatal("renamed file was rejected")
	}
	if !IsChangedFile(repository, "deleted.txt") {
		t.Fatal("deleted file was rejected")
	}
	if IsChangedFile(repository, "../outside.txt") {
		t.Fatal("path traversal was accepted")
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

func gitTestOutput(t *testing.T, directory string, arguments ...string) string {
	t.Helper()
	command := exec.Command("git", arguments...)
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", arguments, err, output)
	}
	return string(output)
}

func findFileStatus(t *testing.T, result Result, name string) FileStatus {
	t.Helper()
	for _, status := range result.FilesStatus {
		if status.Path == name {
			return status
		}
	}
	t.Fatalf("status for %q was not found: %+v", name, result.FilesStatus)
	return FileStatus{}
}

func writeTestFile(t *testing.T, filename, content string) {
	t.Helper()
	if err := os.WriteFile(filename, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

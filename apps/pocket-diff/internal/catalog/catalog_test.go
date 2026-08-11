package catalog

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCountStatusEntriesCountsRenameOnce(t *testing.T) {
	if count := CountStatusEntries("R  new.js\x00old.js\x00?? other.js\x00"); count != 2 {
		t.Fatalf("got %d entries", count)
	}
}

func TestCatalogDiscoversRepositoriesWithoutPublishingPaths(t *testing.T) {
	root := t.TempDir()
	createRepository(t, filepath.Join(root, "clean"), false)
	createRepository(t, filepath.Join(root, "group", "dirty"), true)
	if err := os.MkdirAll(filepath.Join(root, "group", "not-a-repo"), 0o700); err != nil {
		t.Fatal(err)
	}

	catalog := New([]string{root}, 2)
	repositories := catalog.Scan(true)
	if len(repositories) != 2 || repositories[0].Name != "dirty" || repositories[0].Changes != 1 {
		t.Fatalf("unexpected repositories: %+v", repositories)
	}
	encoded, _ := json.Marshal(repositories)
	if strings.Contains(string(encoded), root) || strings.Contains(string(encoded), `"Path"`) || strings.Contains(string(encoded), `"path"`) {
		t.Fatalf("absolute path leaked: %s", encoded)
	}
	resolved, ok := catalog.Resolve(repositories[0].ID)
	expected, _ := filepath.EvalSymlinks(filepath.Join(root, "group", "dirty"))
	if !ok || resolved != expected {
		t.Fatalf("unexpected resolution: %q, %v", resolved, ok)
	}
	if _, ok := catalog.Resolve("not-allowlisted"); ok {
		t.Fatal("unknown repository was resolved")
	}
}

func createRepository(t *testing.T, directory string, dirty bool) {
	t.Helper()
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, directory, "init", "-q")
	runGitTest(t, directory, "config", "user.name", "Pocket Diff Test")
	runGitTest(t, directory, "config", "user.email", "test@example.invalid")
	if err := os.WriteFile(filepath.Join(directory, "README.md"), []byte("# Test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitTest(t, directory, "add", "README.md")
	runGitTest(t, directory, "commit", "-qm", "initial")
	if dirty {
		if err := os.WriteFile(filepath.Join(directory, "change.js"), []byte("export const changed = true;\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func runGitTest(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", arguments...)
	command.Dir = directory
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", arguments, err, output)
	}
}

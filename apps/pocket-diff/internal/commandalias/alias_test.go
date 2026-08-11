//go:build !windows

package commandalias

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureMigratesManagedLegacyCommand(t *testing.T) {
	userHome := t.TempDir()
	managedHome := filepath.Join(userHome, ".pocket-diff")
	t.Setenv("HOME", userHome)
	t.Setenv("POCKET_DIFF_HOME", managedHome)
	legacy := filepath.Join(managedHome, "bin", "pocket-diff")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Ensure(); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(userHome, ".local", "bin", "pcdiff")
	target, err := os.Readlink(destination)
	if err != nil {
		t.Fatal(err)
	}
	if target != legacy {
		t.Fatalf("alias target = %q, want %q", target, legacy)
	}
}

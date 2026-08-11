package uninstall

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/config"
)

func TestParseOptions(t *testing.T) {
	options, err := ParseOptions([]string{"--keep-config", "--dry-run", "--yes"})
	if err != nil {
		t.Fatal(err)
	}
	if !options.KeepConfig || !options.DryRun || !options.Yes {
		t.Fatalf("unexpected options: %+v", options)
	}
}

func TestDryRunPreservesFiles(t *testing.T) {
	home := t.TempDir()
	t.Setenv("POCKET_DIFF_HOME", home)
	configuration := config.Config{BasePath: "/diff", Tailscale: true}
	if err := config.Save(filepath.Join(home, "config.json"), configuration); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := Run(Options{KeepConfig: true, DryRun: true}, strings.NewReader(""), &output); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, "config.json")); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"[dry-run]", "/diff", "Configuration: keep"} {
		if !strings.Contains(output.String(), expected) {
			t.Fatalf("output does not contain %q: %s", expected, output.String())
		}
	}
}

func TestConfirmationDefaultsToCancel(t *testing.T) {
	home := t.TempDir()
	t.Setenv("POCKET_DIFF_HOME", home)
	if err := config.Save(filepath.Join(home, "config.json"), config.Config{}); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := Run(Options{}, strings.NewReader("\n"), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "Cancelled") {
		t.Fatalf("unexpected output: %s", output.String())
	}
}

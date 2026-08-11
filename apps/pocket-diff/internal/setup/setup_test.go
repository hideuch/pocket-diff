package setup

import (
	"bytes"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBinaryNameUsesShortCommand(t *testing.T) {
	want := "pcdiff"
	if runtime.GOOS == "windows" {
		want += ".exe"
	}
	if got := binaryName(); got != want {
		t.Fatalf("binaryName() = %q, want %q", got, want)
	}
}

func TestParseOptionsSupportsRepeatableRoots(t *testing.T) {
	options, err := ParseOptions([]string{"--root", "./one", "--root=./two", "--base-path=diff/", "--port=5000", "--yes", "--dry-run", "--install-tailscale"})
	if err != nil {
		t.Fatal(err)
	}
	if len(options.Roots) != 2 || options.Roots[0] != absolute(t, "./one") || options.Roots[1] != absolute(t, "./two") {
		t.Fatalf("unexpected roots: %v", options.Roots)
	}
	if options.BasePath != "/diff" || options.Port != 5000 || !options.Yes || !options.DryRun || !options.InstallTailscale {
		t.Fatalf("unexpected options: %+v", options)
	}
}

func TestServiceDefinitionsUseStableBinary(t *testing.T) {
	plist := LaunchAgent("/home/bin/pocket-diff", "/home/config.json", "/logs")
	if !strings.Contains(plist, "<string>/home/bin/pocket-diff</string>") || !strings.Contains(plist, "<string>serve</string>") {
		t.Fatalf("unexpected plist: %s", plist)
	}
	unit := SystemdUnit("/home/bin/pocket-diff", "/home/config.json")
	if !strings.Contains(unit, `ExecStart="/home/bin/pocket-diff" serve --config "/home/config.json"`) || !strings.Contains(unit, "Restart=always") {
		t.Fatalf("unexpected unit: %s", unit)
	}
}

func TestDryRunDoesNotInstall(t *testing.T) {
	root := t.TempDir()
	options := Options{Roots: []string{root}, Depth: 1, Port: 4173, BasePath: "/diff", Yes: true, DryRun: true, NoService: true, NoTailscale: true}
	var output bytes.Buffer
	if err := Run(options, strings.NewReader(""), &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "[dry-run] Install binary") || !strings.Contains(output.String(), "Pocket Diff is ready") {
		t.Fatalf("unexpected output: %s", output.String())
	}
}

func TestTailscaleInstallerDryRun(t *testing.T) {
	var output bytes.Buffer
	if err := installTailscale(true, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "Install:") {
		t.Fatalf("unexpected output: %s", output.String())
	}
}

func absolute(t *testing.T, value string) string {
	t.Helper()
	result, err := filepath.Abs(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

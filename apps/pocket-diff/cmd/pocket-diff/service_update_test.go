package main

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"

	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/config"
)

func TestInstalledServiceExecutablePrefersCurrentCommandName(t *testing.T) {
	home := t.TempDir()
	t.Setenv("POCKET_DIFF_HOME", home)
	if err := config.Save(filepath.Join(home, "config.json"), config.Config{Service: true}); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(home, "bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	names := serviceExecutableNames(runtime.GOOS)
	for _, name := range []string{names[1], names[0]} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("binary"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	got, configured, err := installedServiceExecutable()
	if err != nil || !configured {
		t.Fatalf("installedServiceExecutable() = %q, %t, %v", got, configured, err)
	}
	want := filepath.Join(bin, serviceExecutableNames(runtime.GOOS)[0])
	if got != want {
		t.Fatalf("installedServiceExecutable() = %q, want %q", got, want)
	}
}

func TestInstalledServiceExecutableSkipsDisabledService(t *testing.T) {
	home := t.TempDir()
	t.Setenv("POCKET_DIFF_HOME", home)
	if err := config.Save(filepath.Join(home, "config.json"), config.Config{Service: false}); err != nil {
		t.Fatal(err)
	}
	if got, configured, err := installedServiceExecutable(); err != nil || configured || got != "" {
		t.Fatalf("installedServiceExecutable() = %q, %t, %v", got, configured, err)
	}
}

func TestServiceRestartCommands(t *testing.T) {
	cases := []struct {
		goos     string
		commands []serviceCommand
	}{
		{"darwin", []serviceCommand{{"launchctl", []string{"kickstart", "-k", "gui/501/com.pocket-diff"}}}},
		{"linux", []serviceCommand{{"systemctl", []string{"--user", "restart", "pocket-diff.service"}}}},
		{"windows", []serviceCommand{
			{"schtasks.exe", []string{"/End", "/TN", "PocketDiff"}},
			{"schtasks.exe", []string{"/Run", "/TN", "PocketDiff"}},
		}},
	}
	for _, test := range cases {
		commands, err := serviceRestartCommands(test.goos, 501)
		if err != nil || !reflect.DeepEqual(commands, test.commands) {
			t.Fatalf("serviceRestartCommands(%q) = %v, %v", test.goos, commands, err)
		}
	}
}

func TestWaitForWindowsReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pcdiff.exe")
	for _, suffix := range []string{".new", ".update.cmd"} {
		if err := os.WriteFile(path+suffix, []byte("pending"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	go func() {
		time.Sleep(25 * time.Millisecond)
		_ = os.Remove(path + ".new")
		_ = os.Remove(path + ".update.cmd")
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := waitForWindowsReplacement(ctx, path); err != nil {
		t.Fatal(err)
	}
}

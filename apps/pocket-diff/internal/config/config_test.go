package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDefaultsAutoUpdateForExistingConfig(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(filename, []byte(`{"roots":[],"depth":2,"port":4173}`), 0o600); err != nil {
		t.Fatal(err)
	}
	value, err := Load(filename)
	if err != nil {
		t.Fatal(err)
	}
	if !value.AutoUpdate {
		t.Fatal("existing config should enable signed automatic updates")
	}
}

func TestLoadRespectsDisabledAutoUpdate(t *testing.T) {
	filename := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(filename, []byte(`{"autoUpdate":false}`), 0o600); err != nil {
		t.Fatal(err)
	}
	value, err := Load(filename)
	if err != nil {
		t.Fatal(err)
	}
	if value.AutoUpdate {
		t.Fatal("explicitly disabled automatic updates should remain disabled")
	}
}

package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	Roots     []string `json:"roots"`
	Depth     int      `json:"depth"`
	Port      int      `json:"port"`
	BasePath  string   `json:"basePath"`
	Service   bool     `json:"service"`
	Tailscale bool     `json:"tailscale"`
}

func Home() (string, error) {
	if value := os.Getenv("POCKET_DIFF_HOME"); value != "" {
		return filepath.Abs(value)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".pocket-diff"), nil
}

func DefaultPath() (string, error) {
	home, err := Home()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "config.json"), nil
}

func Load(filename string) (Config, error) {
	content, err := os.ReadFile(filename)
	if err != nil {
		return Config{}, err
	}
	var value Config
	if err := json.Unmarshal(content, &value); err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	return value, nil
}

func Save(filename string, value Config) error {
	if err := os.MkdirAll(filepath.Dir(filename), 0o700); err != nil {
		return err
	}
	content, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	content = append(content, '\n')
	return os.WriteFile(filename, content, 0o600)
}

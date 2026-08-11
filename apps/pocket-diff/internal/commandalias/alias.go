package commandalias

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/config"
)

// Ensure migrates installations made before pcdiff became the primary command.
func Ensure() error {
	userHome, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	commandDirectory := filepath.Join(userHome, ".local", "bin")
	destination := filepath.Join(commandDirectory, commandFileName())
	if _, err := os.Lstat(destination); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	home, err := config.Home()
	if err != nil {
		return err
	}
	candidates := []string{
		filepath.Join(home, "bin", commandExecutableName()),
		filepath.Join(home, "bin", legacyExecutableName()),
		filepath.Join(commandDirectory, legacyExecutableName()),
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			if err := os.MkdirAll(commandDirectory, 0o755); err != nil {
				return err
			}
			return create(destination, candidate)
		}
	}
	return nil
}

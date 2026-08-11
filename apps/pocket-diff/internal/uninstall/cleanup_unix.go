//go:build !windows

package uninstall

import (
	"errors"
	"os"
	"path/filepath"
)

func cleanupFiles(home, bootstrap string, keepConfig bool) error {
	paths := []string{bootstrap}
	if keepConfig {
		paths = append(paths,
			filepath.Join(home, "bin"),
			filepath.Join(home, "start-pocket-diff.cmd"),
			filepath.Join(home, "pocket-diff.log"),
			filepath.Join(home, "pocket-diff-error.log"),
		)
	} else {
		paths = append(paths, home)
	}
	for _, path := range paths {
		if err := os.RemoveAll(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

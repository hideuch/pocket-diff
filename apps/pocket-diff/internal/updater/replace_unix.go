//go:build !windows

package updater

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func replaceExecutable(binary []byte, restart bool) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return err
	}
	temporary := executable + ".new"
	if err := os.WriteFile(temporary, binary, 0o755); err != nil {
		return fmt.Errorf("stage update: %w", err)
	}
	if err := os.Chmod(temporary, 0o755); err != nil {
		return err
	}
	if err := os.Rename(temporary, executable); err != nil {
		return fmt.Errorf("install update: %w", err)
	}
	if restart {
		return syscall.Exec(executable, os.Args, os.Environ())
	}
	return nil
}

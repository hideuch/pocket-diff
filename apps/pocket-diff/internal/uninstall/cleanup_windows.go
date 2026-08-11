//go:build windows

package uninstall

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func cleanupFiles(home, bootstrap string, keepConfig bool) error {
	script, err := os.CreateTemp("", "pocket-diff-uninstall-*.cmd")
	if err != nil {
		return err
	}
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
	lines := []string{"@echo off", "ping 127.0.0.1 -n 3 >nul"}
	for _, path := range paths {
		quoted := `"` + strings.ReplaceAll(path, `"`, `""`) + `"`
		lines = append(lines, "if exist "+quoted+" rmdir /s /q "+quoted+" 2>nul", "if exist "+quoted+" del /f /q "+quoted+" 2>nul")
	}
	lines = append(lines, `del /f /q "%~f0"`)
	if _, err := fmt.Fprintln(script, strings.Join(lines, "\r\n")); err != nil {
		script.Close()
		return err
	}
	if err := script.Close(); err != nil {
		return err
	}
	return exec.Command("cmd.exe", "/C", `start "" /B "`+script.Name()+`"`).Start()
}

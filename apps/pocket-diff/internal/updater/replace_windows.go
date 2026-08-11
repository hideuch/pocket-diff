//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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
	helper := executable + ".update.cmd"
	command := "@echo off\r\n:retry\r\nmove /Y " + quote(executable+".new") + " " + quote(executable) + " >nul 2>&1\r\nif errorlevel 1 (ping 127.0.0.1 -n 2 >nul & goto retry)\r\n"
	if restart {
		arguments := make([]string, len(os.Args))
		for index, argument := range os.Args {
			arguments[index] = quote(argument)
		}
		command += "start \"\" " + strings.Join(arguments, " ") + "\r\n"
	}
	command += "del \"%~f0\"\r\n"
	if err := os.WriteFile(helper, []byte(command), 0o600); err != nil {
		return err
	}
	process := exec.Command("cmd.exe", "/C", "start", "", "/B", helper)
	if err := process.Start(); err != nil {
		return err
	}
	if restart {
		os.Exit(0)
	}
	return nil
}

func quote(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

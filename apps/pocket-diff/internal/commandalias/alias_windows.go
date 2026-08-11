//go:build windows

package commandalias

import (
	"os"
	"strings"
)

func commandFileName() string       { return "pcdiff.cmd" }
func commandExecutableName() string { return "pcdiff.exe" }
func legacyExecutableName() string  { return "pocket-diff.exe" }

func create(destination, target string) error {
	target = strings.ReplaceAll(target, `"`, `""`)
	content := "@echo off\r\n\"" + target + "\" %*\r\n"
	return os.WriteFile(destination, []byte(content), 0o600)
}

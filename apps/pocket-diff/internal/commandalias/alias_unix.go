//go:build !windows

package commandalias

import "os"

func commandFileName() string       { return "pcdiff" }
func commandExecutableName() string { return "pcdiff" }
func legacyExecutableName() string  { return "pocket-diff" }

func create(destination, target string) error {
	return os.Symlink(target, destination)
}

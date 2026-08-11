package uninstall

import (
	"bufio"
	"bytes"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/hideuch/pocket-diff/apps/pocket-diff/internal/config"
)

type Options struct {
	KeepConfig bool
	DryRun     bool
	Yes        bool
}

func ParseOptions(arguments []string) (Options, error) {
	set := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	options := Options{}
	set.BoolVar(&options.KeepConfig, "keep-config", false, "preserve configuration")
	set.BoolVar(&options.DryRun, "dry-run", false, "show changes without applying")
	set.BoolVar(&options.Yes, "yes", false, "uninstall without confirmation")
	set.BoolVar(&options.Yes, "y", false, "uninstall without confirmation")
	if err := set.Parse(arguments); err != nil {
		return Options{}, err
	}
	return options, nil
}

func Run(options Options, input io.Reader, output io.Writer) error {
	home, err := config.Home()
	if err != nil {
		return err
	}
	configuration, configured := loadConfig(filepath.Join(home, "config.json"), output)
	userHome, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	bootstraps := []string{
		filepath.Join(userHome, ".local", "bin", commandName()),
		filepath.Join(userHome, ".local", "bin", "pcdiff.cmd"),
		filepath.Join(userHome, ".local", "bin", legacyCommandName()),
	}

	fmt.Fprintln(output, "\nPocket Diff uninstall")
	fmt.Fprintf(output, "  Service: %s\n  Data: %s\n", serviceName(), home)
	if options.KeepConfig {
		fmt.Fprintln(output, "  Configuration: keep")
	} else {
		fmt.Fprintln(output, "  Configuration: remove")
	}
	if configured && configuration.Tailscale {
		fmt.Fprintf(output, "  Tailscale Serve path: %s\n", displayPath(configuration.BasePath))
	}
	if !options.Yes && !options.DryRun {
		fmt.Fprint(output, "Pocket Diffをアンインストールしますか？ [y/N]: ")
		answer, readErr := bufio.NewReader(input).ReadString('\n')
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return readErr
		}
		answer = strings.TrimSpace(strings.ToLower(answer))
		if answer != "y" && answer != "yes" {
			fmt.Fprintln(output, "Cancelled.")
			return nil
		}
	}
	if options.DryRun {
		fmt.Fprintln(output, "[dry-run] Stop and remove the startup service")
		if configured && configuration.Tailscale {
			fmt.Fprintf(output, "[dry-run] Remove only Tailscale Serve path %s\n", displayPath(configuration.BasePath))
		}
		fmt.Fprintf(output, "[dry-run] Remove managed files from %s\n", home)
		return nil
	}

	if err := removeService(userHome); err != nil {
		return err
	}
	if configured && configuration.Tailscale {
		if err := removeTailscaleRoute(configuration.BasePath, output); err != nil {
			return err
		}
	}
	if err := cleanupFiles(home, bootstraps, options.KeepConfig); err != nil {
		return err
	}
	fmt.Fprintln(output, "Pocket Diff was uninstalled. Git repositories were not changed.")
	return nil
}

func loadConfig(filename string, output io.Writer) (config.Config, bool) {
	value, err := config.Load(filename)
	if err == nil {
		return value, true
	}
	if !errors.Is(err, os.ErrNotExist) {
		fmt.Fprintf(output, "Warning: configuration could not be read; Tailscale Serve was left unchanged: %v\n", err)
	}
	return config.Config{}, false
}

func removeService(userHome string) error {
	switch runtime.GOOS {
	case "darwin":
		domain := fmt.Sprintf("gui/%d", userID())
		runOptional("launchctl", "bootout", domain+"/com.pocket-diff")
		runOptional("launchctl", "remove", "com.pocket-diff")
		return removeIfExists(filepath.Join(userHome, "Library", "LaunchAgents", "com.pocket-diff.plist"))
	case "linux":
		runOptional("systemctl", "--user", "disable", "--now", "pocket-diff.service")
		if err := removeIfExists(filepath.Join(userHome, ".config", "systemd", "user", "pocket-diff.service")); err != nil {
			return err
		}
		runOptional("systemctl", "--user", "daemon-reload")
		return nil
	case "windows":
		runOptional("schtasks.exe", "/End", "/TN", "PocketDiff")
		runOptional("schtasks.exe", "/Delete", "/F", "/TN", "PocketDiff")
		return nil
	default:
		return fmt.Errorf("automatic uninstall is not supported on %s", runtime.GOOS)
	}
}

func removeTailscaleRoute(basePath string, output io.Writer) error {
	executable := findTailscale()
	if executable == "" {
		fmt.Fprintln(output, "Warning: Tailscale CLI was not found; its Serve route was left unchanged.")
		return nil
	}
	arguments := []string{"serve", "--https=443"}
	if basePath != "" {
		arguments = append(arguments, "--set-path="+basePath)
	}
	arguments = append(arguments, "off")
	process := exec.Command(executable, arguments...)
	process.Env = append(os.Environ(), "TAILSCALE_BE_CLI=1")
	var stderr bytes.Buffer
	process.Stdout = output
	process.Stderr = &stderr
	if err := process.Run(); err != nil {
		return fmt.Errorf("remove Tailscale Serve route: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func findTailscale() string {
	if executable, err := exec.LookPath("tailscale"); err == nil {
		return executable
	}
	if runtime.GOOS == "darwin" {
		candidate := "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	if runtime.GOOS == "windows" {
		candidate := filepath.Join(os.Getenv("ProgramFiles"), "Tailscale", "tailscale.exe")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func runOptional(command string, arguments ...string) {
	_ = exec.Command(command, arguments...).Run()
}

func removeIfExists(filename string) error {
	err := os.Remove(filename)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func serviceName() string {
	switch runtime.GOOS {
	case "darwin":
		return "LaunchAgent com.pocket-diff"
	case "linux":
		return "systemd user service pocket-diff.service"
	case "windows":
		return "Scheduled Task PocketDiff"
	default:
		return runtime.GOOS
	}
}

func commandName() string {
	if runtime.GOOS == "windows" {
		return "pcdiff.exe"
	}
	return "pcdiff"
}

func legacyCommandName() string {
	if runtime.GOOS == "windows" {
		return "pocket-diff.exe"
	}
	return "pocket-diff"
}

func displayPath(value string) string {
	if value == "" {
		return "/"
	}
	return value
}

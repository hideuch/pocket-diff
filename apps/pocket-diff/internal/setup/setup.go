package setup

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/hidenariTakeuchi/pocket-diff/apps/pocket-diff/internal/config"
	"github.com/hidenariTakeuchi/pocket-diff/apps/pocket-diff/internal/server"
)

const (
	defaultPort  = 4173
	defaultDepth = 2
	defaultPath  = "/diff"
)

type Options struct {
	Roots        []string
	Depth        int
	Port         int
	BasePath     string
	Yes          bool
	DryRun       bool
	NoService    bool
	NoTailscale  bool
	NoAutoUpdate bool
}

type stringList []string

func (values *stringList) String() string { return strings.Join(*values, ",") }
func (values *stringList) Set(value string) error {
	absolute, err := filepath.Abs(value)
	if err != nil {
		return err
	}
	*values = append(*values, absolute)
	return nil
}

func ParseOptions(arguments []string) (Options, error) {
	set := flag.NewFlagSet("setup", flag.ContinueOnError)
	set.SetOutput(io.Discard)
	var roots stringList
	options := Options{}
	set.Var(&roots, "root", "Git repository parent folder (repeatable)")
	set.IntVar(&options.Depth, "depth", defaultDepth, "scan depth")
	set.IntVar(&options.Port, "port", defaultPort, "localhost port")
	set.StringVar(&options.BasePath, "base-path", defaultPath, "Tailnet URL path")
	set.BoolVar(&options.Yes, "yes", false, "accept defaults")
	set.BoolVar(&options.Yes, "y", false, "accept defaults")
	set.BoolVar(&options.DryRun, "dry-run", false, "show changes without applying")
	set.BoolVar(&options.NoService, "no-service", false, "do not configure startup service")
	set.BoolVar(&options.NoTailscale, "no-tailscale", false, "do not configure Tailscale Serve")
	set.BoolVar(&options.NoAutoUpdate, "no-auto-update", false, "disable signed automatic updates")
	if err := set.Parse(arguments); err != nil {
		return Options{}, err
	}
	options.Roots = roots
	options.BasePath = server.NormalizeBasePath(options.BasePath)
	return options, nil
}

func Run(options Options, input io.Reader, output io.Writer) error {
	root, err := defaultRoot()
	if err != nil {
		return err
	}
	value := config.Config{
		Roots: options.Roots, Depth: options.Depth, Port: options.Port, BasePath: options.BasePath,
		Service: !options.NoService, Tailscale: !options.NoTailscale, AutoUpdate: !options.NoAutoUpdate,
	}
	if len(value.Roots) == 0 {
		value.Roots = []string{root}
	}
	if !options.Yes {
		value, err = prompt(value, input, output)
		if err != nil {
			return err
		}
	}
	value.Depth = max(0, min(value.Depth, 8))
	if value.Port < 1024 || value.Port > 65535 {
		return errors.New("port must be between 1024 and 65535")
	}
	for index, root := range value.Roots {
		absolute, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		info, err := os.Stat(absolute)
		if err != nil || !info.IsDir() {
			return fmt.Errorf("root folder does not exist: %s", root)
		}
		value.Roots[index] = absolute
	}

	fmt.Fprintf(output, "\nConfiguration\n  Git roots: %s\n  Scan depth: %d\n  Local port: %d\n  URL path: %s\n  Signed auto-update: %t\n", strings.Join(value.Roots, ", "), value.Depth, value.Port, displayPath(value.BasePath), value.AutoUpdate)
	home, err := config.Home()
	if err != nil {
		return err
	}
	binaryPath := filepath.Join(home, "bin", binaryName())
	configPath := filepath.Join(home, "config.json")
	if options.DryRun {
		fmt.Fprintf(output, "[dry-run] Install binary: %s\n[dry-run] Write config: %s\n", binaryPath, configPath)
	} else {
		if err := installSelf(binaryPath); err != nil {
			return err
		}
		if err := config.Save(configPath, value); err != nil {
			return err
		}
	}
	if value.Service {
		if err := configureService(binaryPath, configPath, home, options.DryRun, output); err != nil {
			return err
		}
	}
	url := ""
	if value.Tailscale {
		url, err = configureTailscale(value, options.DryRun, output)
		if err != nil {
			return err
		}
	}
	fmt.Fprintln(output, "\nPocket Diff is ready.")
	if url != "" {
		fmt.Fprintf(output, "Open: %s\n", url)
	} else {
		fmt.Fprintf(output, "Local: http://127.0.0.1:%d%s/\n", value.Port, value.BasePath)
	}
	return nil
}

func prompt(value config.Config, input io.Reader, output io.Writer) (config.Config, error) {
	reader := bufio.NewReader(input)
	fmt.Fprint(output, "\nPocket Diff setup\n\n")
	root, err := ask(reader, output, "Gitフォルダの親ディレクトリ（複数はカンマ区切り）", strings.Join(value.Roots, ","))
	if err != nil {
		return value, err
	}
	depth, err := ask(reader, output, "探索する深さ", strconv.Itoa(value.Depth))
	if err != nil {
		return value, err
	}
	basePath, err := ask(reader, output, "Tailnet内のURLパス", displayPath(value.BasePath))
	if err != nil {
		return value, err
	}
	port, err := ask(reader, output, "localhostポート", strconv.Itoa(value.Port))
	if err != nil {
		return value, err
	}
	service, err := ask(reader, output, "OS起動時に自動起動しますか？", "Y/n")
	if err != nil {
		return value, err
	}
	tailscale, err := ask(reader, output, "Tailscale Serveを設定しますか？", "Y/n")
	if err != nil {
		return value, err
	}
	value.Roots = splitRoots(root)
	value.Depth, _ = strconv.Atoi(depth)
	value.Port, _ = strconv.Atoi(port)
	value.BasePath = server.NormalizeBasePath(basePath)
	value.Service = !strings.HasPrefix(strings.ToLower(service), "n")
	value.Tailscale = !strings.HasPrefix(strings.ToLower(tailscale), "n")
	autoUpdate, err := ask(reader, output, "署名を検証して自動アップデートしますか？", "Y/n")
	if err != nil {
		return value, err
	}
	value.AutoUpdate = !strings.HasPrefix(strings.ToLower(autoUpdate), "n")
	return value, nil
}

func ask(reader *bufio.Reader, output io.Writer, label, fallback string) (string, error) {
	fmt.Fprintf(output, "%s [%s]: ", label, fallback)
	answer, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	answer = strings.TrimSpace(answer)
	if answer == "" {
		return fallback, nil
	}
	return answer, nil
}

func splitRoots(value string) []string {
	var roots []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			roots = append(roots, item)
		}
	}
	return roots
}

func defaultRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	for _, candidate := range []string{filepath.Join(home, "repos"), filepath.Join(home, "projects")} {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, nil
		}
	}
	return os.Getwd()
}

func installSelf(destination string) error {
	source, err := os.Executable()
	if err != nil {
		return err
	}
	source, err = filepath.EvalSymlinks(source)
	if err != nil {
		return err
	}
	if installed, err := filepath.EvalSymlinks(destination); err == nil && installed == source {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	temporary := destination + ".new"
	output, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if runtime.GOOS == "windows" {
		_ = os.Remove(destination)
	}
	return os.Rename(temporary, destination)
}

func binaryName() string {
	if runtime.GOOS == "windows" {
		return "pocket-diff.exe"
	}
	return "pocket-diff"
}

func configureService(binaryPath, configPath, home string, dryRun bool, output io.Writer) error {
	if dryRun {
		fmt.Fprintf(output, "[dry-run] Configure %s background service\n", runtime.GOOS)
		return nil
	}
	switch runtime.GOOS {
	case "darwin":
		userHome, _ := os.UserHomeDir()
		directory := filepath.Join(userHome, "Library", "LaunchAgents")
		filename := filepath.Join(directory, "com.pocket-diff.plist")
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filename, []byte(LaunchAgent(binaryPath, configPath, home)), 0o644); err != nil {
			return err
		}
		domain := fmt.Sprintf("gui/%d", userID())
		_ = run(false, "launchctl", "bootout", domain+"/com.pocket-diff")
		_ = run(false, "launchctl", "remove", "com.pocket-diff")
		return run(true, "launchctl", "bootstrap", domain, filename)
	case "linux":
		userHome, _ := os.UserHomeDir()
		directory := filepath.Join(userHome, ".config", "systemd", "user")
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(directory, "pocket-diff.service"), []byte(SystemdUnit(binaryPath, configPath)), 0o644); err != nil {
			return err
		}
		if err := run(true, "systemctl", "--user", "daemon-reload"); err != nil {
			return err
		}
		return run(true, "systemctl", "--user", "enable", "--now", "pocket-diff.service")
	case "windows":
		commandFile := filepath.Join(home, "start-pocket-diff.cmd")
		command := fmt.Sprintf("@echo off\r\n\"%s\" serve --config \"%s\"\r\n", binaryPath, configPath)
		if err := os.WriteFile(commandFile, []byte(command), 0o600); err != nil {
			return err
		}
		if err := run(true, "schtasks.exe", "/Create", "/F", "/SC", "ONLOGON", "/TN", "PocketDiff", "/TR", commandFile); err != nil {
			return err
		}
		return run(true, "schtasks.exe", "/Run", "/TN", "PocketDiff")
	default:
		return fmt.Errorf("automatic service setup is not supported on %s", runtime.GOOS)
	}
}

func configureTailscale(value config.Config, dryRun bool, output io.Writer) (string, error) {
	if _, err := exec.LookPath("tailscale"); err != nil {
		fmt.Fprintln(output, "Tailscale CLI was not found. Install and sign in, then rerun setup.")
		return "", nil
	}
	arguments := []string{"serve", "--bg"}
	if value.BasePath != "" {
		arguments = append(arguments, "--set-path="+value.BasePath)
	}
	arguments = append(arguments, fmt.Sprintf("http://127.0.0.1:%d", value.Port))
	if dryRun {
		fmt.Fprintf(output, "[dry-run] tailscale %s\n", strings.Join(arguments, " "))
		return "(dry-run)", nil
	}
	if err := run(true, "tailscale", arguments...); err != nil {
		return "", err
	}
	command := exec.Command("tailscale", "status", "--json")
	status, err := command.Output()
	if err != nil {
		return "", nil
	}
	var result struct{ Self struct{ DNSName string } }
	if json.Unmarshal(status, &result) != nil || result.Self.DNSName == "" {
		return "", nil
	}
	return "https://" + strings.TrimSuffix(result.Self.DNSName, ".") + value.BasePath + "/", nil
}

func run(required bool, command string, arguments ...string) error {
	process := exec.Command(command, arguments...)
	var stderr bytes.Buffer
	process.Stdout = os.Stdout
	process.Stderr = &stderr
	err := process.Run()
	if err != nil && required {
		return fmt.Errorf("%s: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func LaunchAgent(binaryPath, configPath, logDirectory string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.pocket-diff</string>
  <key>ProgramArguments</key><array><string>` + xml(binaryPath) + `</string><string>serve</string><string>--config</string><string>` + xml(configPath) + `</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>` + xml(filepath.Join(logDirectory, "pocket-diff.log")) + `</string>
  <key>StandardErrorPath</key><string>` + xml(filepath.Join(logDirectory, "pocket-diff-error.log")) + `</string>
</dict></plist>
`
}

func SystemdUnit(binaryPath, configPath string) string {
	return "[Unit]\nDescription=Pocket Diff\nAfter=network.target\n\n[Service]\nExecStart=" + systemdQuote(binaryPath) + " serve --config " + systemdQuote(configPath) + "\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n"
}

func xml(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	return strings.ReplaceAll(value, `"`, "&quot;")
}

func systemdQuote(value string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(value, `\`, `\\`), `"`, `\"`) + `"`
}

func displayPath(value string) string {
	if value == "" {
		return "/"
	}
	return value
}

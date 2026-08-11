package setup

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const (
	tailscaleInstallURL  = "https://tailscale.com/install.sh"
	tailscalePackagesURL = "https://pkgs.tailscale.com/stable/"
)

var macPackagePattern = regexp.MustCompile(`href="(Tailscale-[0-9]+(?:\.[0-9]+)*-macos\.pkg)"`)

func ensureTailscale(options Options, reader *bufio.Reader, output io.Writer) (string, error) {
	executable := findTailscale()
	if executable == "" {
		install := options.InstallTailscale
		if !options.Yes && !install {
			fmt.Fprintln(output, "Tailscale Terms: https://tailscale.com/terms")
			answer, err := ask(reader, output, "Tailscale CLIが見つかりません。公式の方法でインストールしますか？", "Y/n")
			if err != nil {
				return "", err
			}
			install = !strings.HasPrefix(strings.ToLower(answer), "n")
		}
		if !install {
			fmt.Fprintln(output, "Tailscale installation skipped. See https://tailscale.com/download")
			return "", nil
		}
		if err := installTailscale(options.DryRun, output); err != nil {
			return "", err
		}
		if options.DryRun {
			return "tailscale", nil
		}
		executable = findTailscale()
		if executable == "" {
			return "", errors.New("Tailscale was installed but its CLI could not be found; open Tailscale and enable CLI integration")
		}
	}
	if !tailscaleIsRunning(executable) {
		fmt.Fprintln(output, "Tailscaleを起動し、ブラウザでTailnetへログインしてください。")
		if runtime.GOOS == "darwin" {
			_ = exec.Command("open", "-a", "Tailscale").Run()
		}
		if err := runTailscale(executable, true, "up"); err != nil {
			return "", fmt.Errorf("Tailscale login: %w", err)
		}
	}
	return executable, nil
}

func tailscaleIsRunning(executable string) bool {
	process := exec.Command(executable, "status", "--json")
	process.Env = append(os.Environ(), "TAILSCALE_BE_CLI=1")
	var status struct {
		BackendState string
	}
	content, err := process.Output()
	if err != nil {
		return false
	}
	return json.Unmarshal(content, &status) == nil && status.BackendState == "Running"
}

func findTailscale() string {
	if executable, err := exec.LookPath("tailscale"); err == nil {
		return executable
	}
	candidates := []string{}
	switch runtime.GOOS {
	case "darwin":
		candidates = append(candidates, "/Applications/Tailscale.app/Contents/MacOS/Tailscale")
	case "windows":
		if programFiles := os.Getenv("ProgramFiles"); programFiles != "" {
			candidates = append(candidates, filepath.Join(programFiles, "Tailscale", "tailscale.exe"))
		}
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func installTailscale(dryRun bool, output io.Writer) error {
	switch runtime.GOOS {
	case "darwin":
		fmt.Fprintln(output, "Install: official Tailscale macOS package (SHA-256 verified)")
		if dryRun {
			return nil
		}
		return installTailscaleMacOS(output)
	case "linux":
		fmt.Fprintln(output, "Install: official Tailscale Linux installer")
		if dryRun {
			return nil
		}
		if _, err := exec.LookPath("curl"); err != nil {
			return errors.New("curl is required to download the official Tailscale installer")
		}
		installer, err := os.CreateTemp("", "pocket-diff-tailscale-install-*.sh")
		if err != nil {
			return err
		}
		installerPath := installer.Name()
		if err := installer.Close(); err != nil {
			return err
		}
		defer os.Remove(installerPath)
		if err := run(true, "curl", "--fail", "--location", "--silent", "--show-error", "--output", installerPath, tailscaleInstallURL); err != nil {
			return err
		}
		return run(true, "sudo", "sh", installerPath)
	case "windows":
		if _, err := exec.LookPath("winget.exe"); err != nil {
			return errors.New("automatic Tailscale installation on Windows requires winget; install from https://tailscale.com/download/windows")
		}
		fmt.Fprintln(output, "Install: winget install Tailscale.Tailscale")
		if dryRun {
			return nil
		}
		return run(true, "winget.exe", "install", "--id", "Tailscale.Tailscale", "--exact", "--accept-package-agreements", "--accept-source-agreements")
	default:
		return fmt.Errorf("automatic Tailscale installation is not supported on %s", runtime.GOOS)
	}
}

func installTailscaleMacOS(output io.Writer) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	index, err := downloadSmall(client, tailscalePackagesURL, 2<<20)
	if err != nil {
		return fmt.Errorf("read Tailscale package index: %w", err)
	}
	match := macPackagePattern.FindSubmatch(index)
	if len(match) != 2 {
		return errors.New("official Tailscale macOS package was not found")
	}
	name := string(match[1])
	checksum, err := downloadSmall(client, tailscalePackagesURL+name+".sha256", 4096)
	if err != nil {
		return fmt.Errorf("download Tailscale checksum: %w", err)
	}
	fields := strings.Fields(string(checksum))
	if len(fields) == 0 || len(fields[0]) != 64 {
		return errors.New("invalid Tailscale package checksum")
	}
	if _, err := hex.DecodeString(fields[0]); err != nil {
		return errors.New("invalid Tailscale package checksum")
	}

	packageFile, err := os.CreateTemp("", "pocket-diff-tailscale-*.pkg")
	if err != nil {
		return err
	}
	packagePath := packageFile.Name()
	defer os.Remove(packagePath)
	response, err := client.Get(tailscalePackagesURL + name)
	if err != nil {
		packageFile.Close()
		return fmt.Errorf("download Tailscale package: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		packageFile.Close()
		return fmt.Errorf("download Tailscale package: HTTP %s", response.Status)
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(packageFile, hash), io.LimitReader(response.Body, (256<<20)+1))
	closeErr := packageFile.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written > 256<<20 {
		return errors.New("Tailscale package exceeds the download size limit")
	}
	actual := fmt.Sprintf("%x", hash.Sum(nil))
	if !strings.EqualFold(actual, fields[0]) {
		return errors.New("Tailscale package SHA-256 verification failed")
	}
	fmt.Fprintf(output, "Verified %s (SHA-256: %s)\n", name, actual)
	return run(true, "sudo", "installer", "-pkg", packagePath, "-target", "/")
}

func downloadSmall(client *http.Client, url string, limit int64) ([]byte, error) {
	response, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %s", response.Status)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > limit {
		return nil, errors.New("download exceeds the size limit")
	}
	return content, nil
}

func runTailscale(executable string, required bool, arguments ...string) error {
	process := exec.Command(executable, arguments...)
	process.Env = append(os.Environ(), "TAILSCALE_BE_CLI=1")
	var stderr bytes.Buffer
	process.Stdout = os.Stdout
	process.Stderr = &stderr
	err := process.Run()
	if err != nil && required {
		return fmt.Errorf("%s: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

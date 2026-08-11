package updater

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/sigstore/sigstore-go/pkg/bundle"
	"github.com/sigstore/sigstore-go/pkg/fulcio/certificate"
	"github.com/sigstore/sigstore-go/pkg/root"
	"github.com/sigstore/sigstore-go/pkg/tuf"
	"github.com/sigstore/sigstore-go/pkg/verify"
)

const (
	Repository       = "hidenariTakeuchi/diff"
	attestationAsset = "attestation.sigstore.json"
	maxAssetSize     = 128 << 20
)

var ErrDevelopmentBuild = errors.New("automatic updates are disabled for development builds")

type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

type Release struct {
	TagName string  `json:"tag_name"`
	Draft   bool    `json:"draft"`
	Assets  []Asset `json:"assets"`
}

type Client struct {
	HTTPClient *http.Client
	APIBase    string
	GOOS       string
	GOARCH     string
}

type Result struct {
	Current string
	Latest  string
	Updated bool
}

func DefaultClient() Client {
	return Client{
		HTTPClient: &http.Client{Timeout: 2 * time.Minute},
		APIBase:    "https://api.github.com",
		GOOS:       runtime.GOOS,
		GOARCH:     runtime.GOARCH,
	}
}

func (client Client) Check(ctx context.Context, current string) (Release, bool, error) {
	if current == "" || current == "dev" {
		return Release{}, false, ErrDevelopmentBuild
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(client.APIBase, "/")+"/repos/"+Repository+"/releases/latest", nil)
	if err != nil {
		return Release{}, false, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2026-03-10")
	response, err := client.httpClient().Do(request)
	if err != nil {
		return Release{}, false, fmt.Errorf("check release: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Release{}, false, fmt.Errorf("check release: GitHub returned %s", response.Status)
	}
	var release Release
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&release); err != nil {
		return Release{}, false, fmt.Errorf("decode release: %w", err)
	}
	if release.Draft || release.TagName == "" {
		return Release{}, false, errors.New("latest release is not publishable")
	}
	if !strings.HasPrefix(release.TagName, "v") {
		return Release{}, false, errors.New("latest release does not use a protected v* tag")
	}
	newer, err := isNewer(current, release.TagName)
	if err != nil {
		return Release{}, false, err
	}
	return release, newer, nil
}

func (client Client) Update(ctx context.Context, current string, restart bool) (Result, error) {
	release, newer, err := client.Check(ctx, current)
	if err != nil {
		return Result{Current: current}, err
	}
	result := Result{Current: current, Latest: release.TagName}
	if !newer {
		return result, nil
	}
	archiveName, err := archiveName(client.GOOS, client.GOARCH)
	if err != nil {
		return result, err
	}
	archiveAsset, ok := findAsset(release.Assets, archiveName)
	if !ok {
		return result, fmt.Errorf("release %s does not contain %s", release.TagName, archiveName)
	}
	attestation, ok := findAsset(release.Assets, attestationAsset)
	if !ok {
		return result, fmt.Errorf("release %s has no signed attestation", release.TagName)
	}
	archiveBytes, err := client.download(ctx, archiveAsset)
	if err != nil {
		return result, err
	}
	bundleBytes, err := client.download(ctx, attestation)
	if err != nil {
		return result, err
	}
	if err := verifyAttestation(archiveBytes, bundleBytes, release.TagName); err != nil {
		return result, fmt.Errorf("refuse untrusted update: %w", err)
	}
	binary, err := extractBinary(archiveBytes, archiveName)
	if err != nil {
		return result, err
	}
	if err := replaceExecutable(binary, restart); err != nil {
		return result, err
	}
	result.Updated = true
	return result, nil
}

func (client Client) download(ctx context.Context, asset Asset) ([]byte, error) {
	if asset.Size <= 0 || asset.Size > maxAssetSize {
		return nil, fmt.Errorf("invalid asset size for %s", asset.Name)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, asset.BrowserDownloadURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.httpClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", asset.Name, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download %s: server returned %s", asset.Name, response.Status)
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxAssetSize+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > maxAssetSize || int64(len(content)) != asset.Size {
		return nil, fmt.Errorf("downloaded size mismatch for %s", asset.Name)
	}
	return content, nil
}

func (client Client) httpClient() *http.Client {
	if client.HTTPClient != nil {
		return client.HTTPClient
	}
	return http.DefaultClient
}

func verifyAttestation(artifact, bundleJSON []byte, tag string) error {
	temporary, err := os.CreateTemp("", "pocket-diff-attestation-*.json")
	if err != nil {
		return err
	}
	path := temporary.Name()
	defer os.Remove(path)
	if _, err := temporary.Write(bundleJSON); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	signedBundle, err := bundle.LoadJSONFromPath(path)
	if err != nil {
		return fmt.Errorf("parse Sigstore bundle: %w", err)
	}
	tufClient, err := tuf.DefaultClient()
	if err != nil {
		return fmt.Errorf("load Sigstore trust root: %w", err)
	}
	trustedRootJSON, err := tufClient.GetTarget("trusted_root.json")
	if err != nil {
		return fmt.Errorf("load Sigstore trusted material: %w", err)
	}
	trustedRoot, err := root.NewTrustedRootFromJSON(trustedRootJSON)
	if err != nil {
		return err
	}
	verifier, err := verify.NewVerifier(trustedRoot,
		verify.WithSignedCertificateTimestamps(1),
		verify.WithObserverTimestamps(1),
		verify.WithTransparencyLog(1),
	)
	if err != nil {
		return err
	}
	identity, err := releaseIdentity(tag)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(artifact)
	_, err = verifier.Verify(signedBundle, verify.NewPolicy(
		verify.WithArtifactDigest("sha256", digest[:]),
		verify.WithCertificateIdentity(identity),
	))
	return err
}

func releaseIdentity(tag string) (verify.CertificateIdentity, error) {
	ref := "refs/tags/" + tag
	workflow := "https://github.com/" + Repository + "/.github/workflows/release.yml@" + ref
	san, err := verify.NewSANMatcher(workflow, "")
	if err != nil {
		return verify.CertificateIdentity{}, err
	}
	issuer, err := verify.NewIssuerMatcher("https://token.actions.githubusercontent.com", "")
	if err != nil {
		return verify.CertificateIdentity{}, err
	}
	return verify.NewCertificateIdentity(san, issuer, certificate.Extensions{
		BuildSignerURI:                      workflow,
		SourceRepositoryURI:                 "https://github.com/" + Repository,
		SourceRepositoryRef:                 ref,
		BuildTrigger:                        "push",
		SourceRepositoryVisibilityAtSigning: "public",
	})
}

func extractBinary(content []byte, archive string) ([]byte, error) {
	if strings.HasSuffix(archive, ".zip") {
		reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
		if err != nil {
			return nil, err
		}
		for _, file := range reader.File {
			if path.Base(filepath.ToSlash(file.Name)) != "pocket-diff.exe" || file.FileInfo().IsDir() {
				continue
			}
			input, err := file.Open()
			if err != nil {
				return nil, err
			}
			defer input.Close()
			return readBinary(input, file.UncompressedSize64)
		}
		return nil, errors.New("archive does not contain pocket-diff.exe")
	}
	gzipReader, err := gzip.NewReader(bytes.NewReader(content))
	if err != nil {
		return nil, err
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if path.Base(filepath.ToSlash(header.Name)) == "pocket-diff" && header.Typeflag == tar.TypeReg {
			return readBinary(tarReader, uint64(header.Size))
		}
	}
	return nil, errors.New("archive does not contain pocket-diff")
}

func readBinary(reader io.Reader, size uint64) ([]byte, error) {
	if size == 0 || size > maxAssetSize {
		return nil, errors.New("invalid binary size")
	}
	content, err := io.ReadAll(io.LimitReader(reader, int64(size)+1))
	if err != nil {
		return nil, err
	}
	if uint64(len(content)) != size {
		return nil, errors.New("binary size mismatch")
	}
	return content, nil
}

func findAsset(assets []Asset, name string) (Asset, bool) {
	for _, asset := range assets {
		if asset.Name == name {
			return asset, true
		}
	}
	return Asset{}, false
}

func archiveName(goos, goarch string) (string, error) {
	switch {
	case goos == "windows" && goarch == "amd64":
		return "pocket-diff_windows_amd64.zip", nil
	case (goos == "darwin" || goos == "linux") && (goarch == "amd64" || goarch == "arm64"):
		return "pocket-diff_" + goos + "_" + goarch + ".tar.gz", nil
	default:
		return "", fmt.Errorf("automatic updates are not supported on %s/%s", goos, goarch)
	}
}

func isNewer(current, latest string) (bool, error) {
	currentParts, err := versionParts(current)
	if err != nil {
		return false, fmt.Errorf("current version: %w", err)
	}
	latestParts, err := versionParts(latest)
	if err != nil {
		return false, fmt.Errorf("latest version: %w", err)
	}
	for index := range currentParts {
		if latestParts[index] != currentParts[index] {
			return latestParts[index] > currentParts[index], nil
		}
	}
	return false, nil
}

func versionParts(value string) ([3]int, error) {
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	value = strings.SplitN(value, "-", 2)[0]
	items := strings.Split(value, ".")
	if len(items) != 3 {
		return [3]int{}, fmt.Errorf("invalid semantic version %q", value)
	}
	var result [3]int
	for index, item := range items {
		parsed, err := strconv.Atoi(item)
		if err != nil || parsed < 0 {
			return [3]int{}, fmt.Errorf("invalid semantic version %q", value)
		}
		result[index] = parsed
	}
	return result, nil
}

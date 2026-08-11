export type Repository = {
  id: string;
  name: string;
  label: string;
  branch: string;
  changes: number;
};

export type DiffResponse = {
  repo: string;
  branch: string;
  base: string;
  patch: string;
  revision: string;
  summary: { additions: number; deletions: number; files: number };
  skipped: string[];
  generatedAt: string;
};

export type ApiError = {
  error?: string;
  detail?: string;
};

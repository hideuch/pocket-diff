import type { ReactNode } from "react";

const iconPaths = {
  branch: <path d="M6 3v9a3 3 0 0 0 3 3h6M6 3a2 2 0 1 0 0 .01M15 15a2 2 0 1 0 0 .01M15 5a2 2 0 1 0 0 .01M15 7v3" />,
  refresh: <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />,
  file: <path d="M7 3h7l4 4v14H7zM14 3v5h5" />,
  folder: <path d="M3 6.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  arrow: <path d="m15 18-6-6 6-6" />,
  down: <path d="m7 10 5 5 5-5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: <path d="m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0" />,
  repo: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 1 4 16.5zM4 16.5A2.5 2.5 0 0 1 6.5 14H19" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof iconPaths;

type IconProps = {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 18 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}

import { identity, brandPath } from '../../src/shared/brand.js';

export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${identity.viewBox} ${identity.viewBox}`}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={brandPath} />
    </svg>
  );
}

import { useState } from "react";
import type { Resource } from "../lib/types";

interface Props {
  resource: Pick<Resource, "name" | "color" | "initials" | "avatarUrl">;
  className?: string;
  title?: string;
}

/** Circular resource icon — Jira profile photo when available, else initials. */
export function ResourceAvatar({ resource, className = "", title }: Props) {
  const [broken, setBroken] = useState(false);
  const showImg = !!resource.avatarUrl && !broken;
  const cls = `pg-avatar${className ? ` ${className}` : ""}${showImg ? " has-img" : ""}`;

  return (
    <span
      className={cls}
      style={showImg ? undefined : { background: resource.color }}
      title={title ?? resource.name}
    >
      {showImg ? (
        <img
          src={resource.avatarUrl!}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        resource.initials
      )}
    </span>
  );
}

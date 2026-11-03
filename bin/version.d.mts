export declare const MIN_NODE_VERSION: string;

export declare function compareVersions(left: string, right: string): number;

export declare function isSupportedNodeVersion(
  current: string,
  minimum?: string,
): boolean;

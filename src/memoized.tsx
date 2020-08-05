import React from 'react';

type MemoRef<T> = {
    depvals: readonly any[];
    value: T;
};

export function memoized<T>(ref: React.MutableRefObject<MemoRef<T> | undefined>, fn: () => T, deplist: readonly any[]) {
    if (!ref.current || deplist.findIndex((cur, i) => ref.current!.depvals[i] !== cur) !== -1) {
        ref.current = {
            depvals: deplist,
            value: fn(),
        };
    }
    return ref.current.value;
}

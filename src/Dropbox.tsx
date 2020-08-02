import React from 'react';

interface ChromeFile {
    arrayBuffer(): Promise<ArrayBuffer>;
}

const onDrop = (onFileDrop: (ab: ArrayBuffer) => void) => function (e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
        // uh... yes. only for Chrome.
        (file as File & ChromeFile).arrayBuffer().then(onFileDrop);
    }
};

// XXX: currently only single file dropping is supported.
export function Dropbox({ onFileDrop, children }: { onFileDrop: (ab: ArrayBuffer) => void; children: React.ReactNode; }) {
    return <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop(onFileDrop)}>{children}</div>;
}

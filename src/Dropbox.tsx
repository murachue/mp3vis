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
// export function Dropbox({ children, onFileDrop, ...props }:{onFileDrop:(files:string[])=>void}) {
//     return (<div onDragOver={} onDrop={} {...props} />);
// }
// https://qiita.com/sangotaro/items/3ea63110517a1b66745b
// export const Dropbox: React.FunctionComponent<{ onFileDrop: (ab: ArrayBuffer) => void; }> = ({ onFileDrop, children, ...props }) =>
//     <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop(onFileDrop)} {...props} />;
// typing wrapping component is a mess!!
export function Dropbox({ onFileDrop, children, ...props }: { onFileDrop: (ab: ArrayBuffer) => void; } & JSX.IntrinsicElements["div"] & { children: React.ReactNode[]; }) {
    return <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop(onFileDrop)} {...props}>{children}</div>;
}

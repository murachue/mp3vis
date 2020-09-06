import React from 'react';

export const BytesEntry = ({ desc, offset, bits, value, hiOffset, onClick }: { desc: string; offset: number; bits: number; value: string; hiOffset: number | null; onClick?: (offset: number, bits: number) => void; }) =>
    <>
        <tr onClick={e => onClick?.(offset, bits)} style={{ background: offset === hiOffset ? "#ddf" : undefined }}>
            <th style={{ textAlign: "right", paddingRight: "1em" }}>{desc}</th>
            <td>{value}</td>
        </tr>
    </>;

export const BytesNote = ({ title }: { title: string; }) =>
    <>
        <tr>
            <td colSpan={2} style={{ margin: "2px" }}>{title}</td>
        </tr>
    </>;

export const BytesSection = ({ color, title, children }: { color: string; title: string; children?: React.ReactNode; }) =>
    <>
        <tr>
            <td colSpan={2} style={{ background: color, color: "black", margin: "2px" }}>{title}</td>
        </tr>
        {children}
    </>;

export const BytesBox = ({ children }: { children: React.ReactNode; }) =>
    <table>
        <tbody>
            {children}
        </tbody>
    </table>;

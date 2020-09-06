import React from 'react';
import { times } from 'lodash-es';
import './Hexdump.css';

export type Hilight = {
    offset: number;
    bits: number;
};

const hex = (value: number, col: number = 0) => value.toString(16).toUpperCase().padStart(col, "0");

function hexSelectClassName(hilight: Hilight | null, offset: number) {
    if (!hilight) {
        return undefined;
    }

    if (hilight.offset + hilight.bits <= offset || offset + 8 <= hilight.offset) {
        return undefined;
    }

    if (hilight.offset <= offset && offset + 8 <= hilight.offset + hilight.bits) {
        return "select";
    }

    const partBegin = offset < hilight.offset;
    const partEnd = hilight.offset + hilight.bits < offset + 8;

    return partBegin && partEnd
        ? "select-part"
        : partBegin
            ? "select-begin"
            : "select-end";
}

function marginSelectClassName(hilight: Hilight | null, offset: number) {
    if (!hilight) {
        return undefined;
    }

    return hilight.offset < offset && offset < hilight.offset + hilight.bits
        ? "select"
        : undefined;
}

export const Hexdump = ({ data, hilight }: { data: Uint8Array, hilight: Hilight | null; }) => {
    return <div style={{ fontFamily: "monospace" }}>
        <div style={{ display: "flex" }}>
            <div className="header" style={{ flexShrink: 0, minWidth: "2em" }}>{"\u00A0".repeat(4)}</div>
            <div className="header" style={{ flexShrink: 0, width: "0.5em" }} />
            {times(16, i =>
                <div key={`col_${i}`} className="header" style={{ flexShrink: 0, width: "1em" }}>+{hex(i)}</div>
            ).flatMap((e, i) => [i ? <div key={`space_${i}`} className="header" style={{ flexShrink: 0, width: "0.5em" }} /> : null, e])}
        </div>
        {times(Math.ceil(data.length / 16), row => <div key={row} style={{ display: "flex" }}>
            <div className="header" style={{ flexShrink: 0, minWidth: "2em", textAlign: "right" }}>{hex(row * 16, 4)}</div>
            <div style={{ flexShrink: 0, width: "0.5em" }} />
            {times(16, i =>
                <div
                    key={`col_${i}`}
                    className={hexSelectClassName(hilight, 8 * (row * 16 + i))}
                    style={{ flexShrink: 0, width: "1em" }}
                >
                    {(row * 16 + i) < data.length ? hex(data[row * 16 + i], 2) : null}
                </div>
            ).flatMap((e, i) => [i
                ? <div key={`space_${i}`} className={marginSelectClassName(hilight, (row * 16 + i) * 8)} style={{ flexShrink: 0, width: "0.5em" }} />
                : null, e
            ])}
        </div>)}
    </div>;
};

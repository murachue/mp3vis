import React from 'react';
import { times } from 'lodash-es';
import './Hexdump.scss';

export type Hilight = {
    offset: number;
    bits: number;
};

const hex = (value: number, col: number = 0) => value.toString(16).toUpperCase().padStart(col, "0");

function hexSelectClassName(hilight: Hilight | null, offset: number) {
    if (!hilight) {
        return "";
    }

    if (hilight.offset + hilight.bits <= offset || offset + 8 <= hilight.offset) {
        return "";
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
        return "";
    }

    return hilight.offset < offset && offset < hilight.offset + hilight.bits
        ? "select"
        : "";
}

export const Hexdump = ({ data, hilight }: { data: Uint8Array, hilight: Hilight | null; }) => {
    return <div style={{ fontFamily: "monospace" }}>
        <div style={{ display: "flex" }}>
            <div className="header address" style={{ flexShrink: 0, }}>{"\u00A0".repeat(4)}</div>
            <div className="header spacer" style={{ flexShrink: 0, }} />
            {times(16, i =>
                <div key={`col_${i}`} className="header hex" style={{ flexShrink: 0 }}>+{hex(i)}</div>
            ).flatMap((e, i) => [i ? <div key={`space_${i}`} className="header spacer" style={{ flexShrink: 0 }} /> : null, e])}
        </div>
        {times(Math.ceil(data.length / 16), row => <div key={row} style={{ display: "flex" }}>
            <div className="header address" style={{ flexShrink: 0 }}>{hex(row * 16, 4)}</div>
            <div className="spacer" style={{ flexShrink: 0 }} />
            {times(16, i =>
                <div
                    key={`col_${i}`}
                    className={"hex " + hexSelectClassName(hilight, 8 * (row * 16 + i))}
                    style={{ flexShrink: 0 }}
                >
                    {(row * 16 + i) < data.length ? hex(data[row * 16 + i], 2) : null}
                </div>
            ).flatMap((e, i) => [i
                ? <div key={`space_${i}`} className={"spacer " + marginSelectClassName(hilight, (row * 16 + i) * 8)} style={{ flexShrink: 0 }} />
                : null, e
            ])}
        </div>)}
    </div>;
};

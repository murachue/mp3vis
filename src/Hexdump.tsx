import React from 'react';
import { times } from 'lodash-es';
import './Hexdump.css';

const hex = (value: number, col: number = 0) => value.toString(16).toUpperCase().padStart(col, "0");

export const Hexdump = ({ data, hilight }: { data: Uint8Array, hilight: { offset: number, bits: number; } | null; }) => {
    return <div style={{ fontFamily: "monospace", fontSize: "9pt" }}>
        <div style={{ display: "flex" }}>
            <div className="header" style={{ flexShrink: 0, minWidth: "2em" }} />
            <div className="header" style={{ flexShrink: 0, width: "0.5em" }} />
            {times(16, i =>
                <div key={`col_${i}`} className="header" style={{ flexShrink: 0, width: "1em" }}>+{hex(i)}</div>
            ).flatMap((e, i) => [i ? <div key={`space_${i}`} className="header" style={{ flexShrink: 0, width: "0.5em" }} /> : null, e])}
        </div>
        {times(Math.ceil(data.length / 16), row => <div key={row} style={{ display: "flex" }}>
            <div className="header" style={{ flexShrink: 0, minWidth: "2em", textAlign: "right" }}>{hex(row * 16, 4)}</div>
            <div style={{ flexShrink: 0, width: "0.5em" }} />
            {times(16, i =>
                <div key={`col_${i}`} style={{ flexShrink: 0, width: "1em" }}>{(row * 16 + i) < data.length ? hex(data[row * 16 + i], 2) : null}</div>
            ).flatMap((e, i) => [i ? <div key={`space_${i}`} style={{ flexShrink: 0, width: "0.5em" }} /> : null, e])}
        </div>)}
    </div>;
};

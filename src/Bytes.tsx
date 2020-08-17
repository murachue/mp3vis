import React from 'react';
import { ParsedFrame } from "./types";
import { Header, layer3_bitrate_kbps, sampling_frequencies, Sideinfo } from "./libmp3";

const toBinary = (value: number, cols: number) => value.toString(2).padStart(cols, "0");

const BytesHeaderEntry = ({ header, field, desc, bits, human }: { header: Header; field: keyof Header; desc?: string; bits: number, human?: (bits: number) => string; }) =>
    <>
        <tr>
            <th style={{ textAlign: "right", paddingRight: "1em" }}>{desc ?? field}</th>
            <td>{toBinary(header[field], bits)}{human ? ` (${human(header[field])})` : null}</td>
        </tr>
    </>;

const BytesHeader = ({ header }: { header: Header; }) =>
    <>
        <div style={{ background: "#cac", color: "black", margin: "2px" }}>header</div>
        <table>
            <BytesHeaderEntry header={header} field="syncword" bits={12} />
            <BytesHeaderEntry header={header} field="id" desc="ID" bits={1} human={id => id ? "MPEG-1" : "MPEG-2"} />
            <BytesHeaderEntry header={header} field="layer" bits={2} human={layer => ["???", "Layer-3", "Layer-2", "Layer-1"][layer]} />
            <BytesHeaderEntry header={header} field="protection_bit" bits={1} human={bit => bit ? "None added" : "CRC-16 added"} />
            <BytesHeaderEntry header={header} field="bitrate_index" bits={4} human={idx => idx === 0 ? "free format" : `${layer3_bitrate_kbps[idx - 1]} kbps`} />
            <BytesHeaderEntry header={header} field="sampling_frequency" bits={2} human={freq => [...sampling_frequencies.map(String), "<reserved>"][freq]} />
            <BytesHeaderEntry header={header} field="padding_bit" bits={1} human={bit => bit ? "padded" : "not-padded"} />
            <BytesHeaderEntry header={header} field="private_bit" bits={1} human={_ => "<undefined>"} />
            <BytesHeaderEntry header={header} field="mode" bits={2} human={mode => ["stereo", "joint-stereo", "dual-channel", "single-channel"][mode]} />
            <BytesHeaderEntry header={header} field="mode_extension" bits={2} human={ext => `${(ext & 2) ? "MiddleSide" : "non-MiddleSide"}, ${(ext & 1) ? "IntensityStereo" : "non-IntensityStereo"}`} />
            <BytesHeaderEntry header={header} field="copyright" bits={1} human={bit => bit ? "Copyright-Protected" : "not-copyrighted"} />
            <BytesHeaderEntry header={header} field="original" bits={1} human={bit => bit ? "original" : "copied"} />
            <BytesHeaderEntry header={header} field="emphasis" bits={2} human={emph => ["no-emphasis", "50/15us", "<reserved>", "CCITT_J.17"][emph]} />
        </table>
    </>;

export function Bytes({ parsedFrame }: { parsedFrame: ParsedFrame | null; }) {
    return parsedFrame === null
        ? <></>
        : <>
            <div>File offset: {parsedFrame.frame.offset}</div>
            <BytesHeader header={parsedFrame.frame.header} />
            {/* crc */}
            {/* <BytesSideinfo sideinfo={parsedFrame.frame.sideinfo} /> */}
        </>;
}

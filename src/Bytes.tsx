import React from 'react';
import { ParsedFrame } from "./types";
import { Header, layer3_bitrate_kbps, sampling_frequencies, Sideinfo, scalefac_compress_tab } from "./libmp3";

const toBinary = (value: number, cols: number) => value.toString(2).padStart(cols, "0");

const toHex = (value: number, cols: number) => `0x${value.toString(16).padStart(cols, "0")}`;

const BytesEntry = ({ desc, value }: { desc: string; value: string; }) =>
    <>
        <tr>
            <th style={{ textAlign: "right", paddingRight: "1em" }}>{desc}</th>
            <td>{value}</td>
        </tr>
    </>;

const BytesSection = ({ color, title, children }: { color: string; title: string; children: React.ReactNode; }) =>
    <>
        <div style={{ background: color, color: "black", margin: "2px" }}>{title}</div>
        <table>
            {children}
        </table>
    </>;

const BytesHeaderEntry = ({ header, field, desc, bits, human }: { header: Header; field: keyof Header; desc?: string; bits: number, human?: (bits: number) => string; }) =>
    <BytesEntry desc={desc ?? field} value={`${toBinary(header[field], bits)}${human ? ` (${human(header[field])})` : ""}`} />;

const BytesHeader = ({ header }: { header: Header; }) =>
    <BytesSection color="#cac" title="header">
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
    </BytesSection>;

type SideinfoNumberFields = "part2_3_length" | "big_values" | "global_gain" | "scalefac_compress" | "preflag" | "scalefac_scale" | "count1table_select" | "region_address1" | "region_address2" | "switch_point";

const BytesSideinfoBinEntry = ({ sideinfo, granule, channel, field, desc, bits, human }: { sideinfo: Sideinfo; granule: number; channel: number; field: SideinfoNumberFields; desc?: string; bits: number, human?: (bits: number) => string; }) =>
    <BytesEntry desc={desc ?? field} value={`${toBinary(sideinfo.channel[channel].granule[granule][field]!, bits)}${human ? ` (${human(sideinfo.channel[channel].granule[granule][field]!)})` : ""}`} />;

const BytesSideinfoDecEntry = ({ sideinfo, granule, channel, field, desc, human }: { sideinfo: Sideinfo; granule: number; channel: number; field: SideinfoNumberFields; desc?: string; human?: (bits: number) => string; }) =>
    <BytesEntry desc={desc ?? field} value={`${sideinfo.channel[channel].granule[granule][field]}${human ? ` (${human(sideinfo.channel[channel].granule[granule][field]!)})` : ""}`} />;

const BytesSideinfoHexEntry = ({ sideinfo, granule, channel, field, desc, cols, human }: { sideinfo: Sideinfo; granule: number; channel: number; field: SideinfoNumberFields; desc?: string; cols: number, human?: (bits: number) => string; }) =>
    <BytesEntry desc={desc ?? field} value={`${toHex(sideinfo.channel[channel].granule[granule][field]!, cols)}${human ? ` (${human(sideinfo.channel[channel].granule[granule][field]!)})` : ""}`} />;

const BytesSideinfoOne = ({ sideinfo, gr, ch }: { sideinfo: Sideinfo; gr: number; ch: number; }) => {
    const sideinfo_gr_ch = sideinfo.channel[ch].granule[gr];
    return <BytesSection color="#fdf" title={`sideinfo granule ${gr} channel ${ch}`}>
        <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="part2_3_length" human={_ => "bits"} />
        <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="big_values" human={_ => "* 2 values"} />
        <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="global_gain" human={_ => "2 ^ (this / 4), +210 biased"} />
        <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="scalefac_compress" human={sfc => scalefac_compress_tab[sfc].join(", ")} />
        <BytesEntry desc="blocksplit_flag" value={`${Number(sideinfo_gr_ch.blocksplit_flag)} (${sideinfo_gr_ch.blocksplit_flag ? "non-normal-window" : "normal-window"})`} />
        {sideinfo_gr_ch.blocksplit_flag === false
            ? <>
                <BytesEntry desc="block_type" value="(0) (normal-block)" />
                <BytesEntry desc="switch_point" value="(0) (no-switch-point)" />
                <BytesEntry desc="table_select[0]" value={`${sideinfo_gr_ch.table_select[0]}`} />
                <BytesEntry desc="table_select[1]" value={`${sideinfo_gr_ch.table_select[1]}`} />
                <BytesEntry desc="table_select[2]" value={`${sideinfo_gr_ch.table_select[2]}`} />
                <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address1" />
                <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address2" />
            </>
            : <>
                <BytesEntry desc="block_type" value={`${sideinfo_gr_ch.block_type} (${["<reserved normal-block>", "start-block", "3 short-windows", "end-block"][sideinfo_gr_ch.block_type]})`} />
                <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="switch_point" human={bit => bit ? "switch-long8-short3" : "no-switch-point"} />
                <BytesEntry desc="table_select[0]" value={`${sideinfo_gr_ch.table_select[0]}`} />
                <BytesEntry desc="table_select[1]" value={`${sideinfo_gr_ch.table_select[1]}`} />
                <BytesEntry desc="table_select[2]" value="(N/A)" />
                <BytesEntry desc="subblock_gain[0]" value={`${sideinfo_gr_ch.subblock_gain[0]}`} />
                <BytesEntry desc="subblock_gain[1]" value={`${sideinfo_gr_ch.subblock_gain[1]}`} />
                <BytesEntry desc="subblock_gain[2]" value={`${sideinfo_gr_ch.subblock_gain[2]}`} />
                <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address1" human={_ => "fixed"} />
                <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address2" human={_ => "fixed"} />
            </>
        }
        <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="preflag" human={bit => bit ? "scalefactor-added" : "no-scalefactor-added"} />
        <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="scalefac_scale" human={bit => bit ? "step 2" : "step sqrt 2"} />
        <BytesSideinfoDecEntry sideinfo={sideinfo} granule={gr} channel={ch} field="count1table_select" human={bit => bit ? "table B" : "table A"} />
    </BytesSection>;
};

const BytesSideinfo = ({ sideinfo }: { sideinfo: Sideinfo; }) =>
    <>
        <BytesSection color="#fdf" title="sideinfo common">
            <BytesEntry desc="main_data_end" value={toHex(sideinfo.main_data_end, 3)} />
            <BytesEntry desc="private_bits" value={toBinary(sideinfo.private_bits, sideinfo.channel.length === 1 ? 5 : 3)} />
        </BytesSection>
        {
            sideinfo.channel.map((ch, ch_i) => <BytesSection color="#fdf" title={`sideinfo scalefactor selection information: channel ${ch_i}`}>
                {ch.scfsi.map((sfb, sfb_i) => <BytesEntry desc={`scfsi_band ${["0..5", "6..10", "11..15", "16..20"][sfb_i]}`} value={`${sfb} (${sfb ? "copy-from-granule-0" : "transmitted"})`} />)}
            </BytesSection>)
        }
        {
            [0, 1].map(gr =>
                <>
                    <BytesSideinfoOne sideinfo={sideinfo} gr={gr} ch={0} />
                    {1 < sideinfo.channel.length && <BytesSideinfoOne sideinfo={sideinfo} gr={gr} ch={1} />}
                </>
            )
        }
    </>;

export function Bytes({ parsedFrame }: { parsedFrame: ParsedFrame | null; }) {
    return parsedFrame === null
        ? <></>
        : <>
            <div>File offset: {parsedFrame.frame.offset}</div>
            <BytesHeader header={parsedFrame.frame.header} />
            {parsedFrame.frame.crc_check === null
                ? null
                : <BytesSection color="#dbd" title="error check">
                    <BytesEntry desc="crc_check" value={toHex(parsedFrame.frame.crc_check, 4)} />
                </BytesSection>}
            <BytesSideinfo sideinfo={parsedFrame.frame.sideinfo} />
        </>;
}

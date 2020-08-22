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
            <tbody>
                {children}
            </tbody>
        </table>
    </>;

const HeaderBytesEntry = ({ header, field, desc, bits, human }: { header: Header; field: keyof Header; desc?: string; bits: number, human?: (bits: number) => string; }) =>
    <BytesEntry desc={desc ?? field} value={`${toBinary(header[field], bits)}${human ? ` (${human(header[field])})` : ""}`} />;

const HeaderBytes = ({ header }: { header: Header; }) =>
    <BytesSection color="#cac" title="header">
        <HeaderBytesEntry header={header} field="syncword" bits={12} />
        <HeaderBytesEntry header={header} field="id" desc="ID" bits={1} human={id => id ? "MPEG-1" : "MPEG-2"} />
        <HeaderBytesEntry header={header} field="layer" bits={2} human={layer => ["???", "Layer-3", "Layer-2", "Layer-1"][layer]} />
        <HeaderBytesEntry header={header} field="protection_bit" bits={1} human={bit => bit ? "None added" : "CRC-16 added"} />
        <HeaderBytesEntry header={header} field="bitrate_index" bits={4} human={idx => idx === 0 ? "free format" : `${layer3_bitrate_kbps[idx - 1]} kbps`} />
        <HeaderBytesEntry header={header} field="sampling_frequency" bits={2} human={freq => [...sampling_frequencies.map(String), "<reserved>"][freq]} />
        <HeaderBytesEntry header={header} field="padding_bit" bits={1} human={bit => bit ? "padded" : "not-padded"} />
        <HeaderBytesEntry header={header} field="private_bit" bits={1} human={_ => "<undefined>"} />
        <HeaderBytesEntry header={header} field="mode" bits={2} human={mode => ["stereo", "joint-stereo", "dual-channel", "single-channel"][mode]} />
        <HeaderBytesEntry header={header} field="mode_extension" bits={2} human={ext => `${(ext & 2) ? "MiddleSide" : "non-MiddleSide"}, ${(ext & 1) ? "IntensityStereo" : "non-IntensityStereo"}`} />
        <HeaderBytesEntry header={header} field="copyright" bits={1} human={bit => bit ? "Copyright-Protected" : "not-copyrighted"} />
        <HeaderBytesEntry header={header} field="original" bits={1} human={bit => bit ? "original" : "copied"} />
        <HeaderBytesEntry header={header} field="emphasis" bits={2} human={emph => ["no-emphasis", "50/15us", "<reserved>", "CCITT_J.17"][emph]} />
    </BytesSection>;

type SideinfoNumberFields = "part2_3_length" | "big_values" | "global_gain" | "scalefac_compress" | "preflag" | "scalefac_scale" | "count1table_select" | "region_address1" | "region_address2" | "switch_point";

const SideinfoDecBytesEntry = ({ sideinfo, granule, channel, field, desc, human }: { sideinfo: Sideinfo; granule: number; channel: number; field: SideinfoNumberFields; desc?: string; human?: (bits: number) => string; }) =>
    <BytesEntry desc={desc ?? field} value={`${sideinfo.channel[channel].granule[granule][field]}${human ? ` (${human(sideinfo.channel[channel].granule[granule][field]!)})` : ""}`} />;

const SideinfoBytesOne = ({ sideinfo, gr, ch }: { sideinfo: Sideinfo; gr: number; ch: number; }) => {
    const sideinfo_gr_ch = sideinfo.channel[ch].granule[gr];
    return <BytesSection color="#fdf" title={`sideinfo granule ${gr} channel ${ch}`}>
        <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="part2_3_length" human={_ => "bits"} />
        <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="big_values" human={_ => "* 2 values"} />
        <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="global_gain" human={_ => "2 ^ (this / 4), +210 biased"} />
        <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="scalefac_compress" human={sfc => scalefac_compress_tab[sfc].join(", ")} />
        <BytesEntry desc="blocksplit_flag" value={`${Number(sideinfo_gr_ch.blocksplit_flag)} (${sideinfo_gr_ch.blocksplit_flag ? "non-normal-window" : "normal-window"})`} />
        {sideinfo_gr_ch.blocksplit_flag === false
            ? <>
                <BytesEntry desc="block_type" value="(0) (normal-block)" />
                <BytesEntry desc="switch_point" value="(0) (no-switch-point)" />
                <BytesEntry desc="table_select[0]" value={`${sideinfo_gr_ch.table_select[0]}`} />
                <BytesEntry desc="table_select[1]" value={`${sideinfo_gr_ch.table_select[1]}`} />
                <BytesEntry desc="table_select[2]" value={`${sideinfo_gr_ch.table_select[2]}`} />
                <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address1" />
                <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address2" />
            </>
            : <>
                <BytesEntry desc="block_type" value={`${sideinfo_gr_ch.block_type} (${["<reserved normal-block>", "start-block", "3 short-windows", "end-block"][sideinfo_gr_ch.block_type]})`} />
                <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="switch_point" human={bit => bit ? "switch-long8-short3" : "no-switch-point"} />
                <BytesEntry desc="table_select[0]" value={`${sideinfo_gr_ch.table_select[0]}`} />
                <BytesEntry desc="table_select[1]" value={`${sideinfo_gr_ch.table_select[1]}`} />
                <BytesEntry desc="table_select[2]" value="(N/A)" />
                <BytesEntry desc="subblock_gain[0]" value={`${sideinfo_gr_ch.subblock_gain[0]}`} />
                <BytesEntry desc="subblock_gain[1]" value={`${sideinfo_gr_ch.subblock_gain[1]}`} />
                <BytesEntry desc="subblock_gain[2]" value={`${sideinfo_gr_ch.subblock_gain[2]}`} />
                <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address1" human={_ => "fixed"} />
                <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="region_address2" human={_ => "fixed"} />
            </>
        }
        <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="preflag" human={bit => bit ? "scalefactor-added" : "no-scalefactor-added"} />
        <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="scalefac_scale" human={bit => bit ? "step 2" : "step sqrt 2"} />
        <SideinfoDecBytesEntry sideinfo={sideinfo} granule={gr} channel={ch} field="count1table_select" human={bit => bit ? "table B" : "table A"} />
    </BytesSection>;
};

const SideinfoBytes = ({ sideinfo }: { sideinfo: Sideinfo; }) =>
    <>
        <BytesSection color="#fdf" title="sideinfo common">
            <BytesEntry desc="main_data_end" value={toHex(sideinfo.main_data_end, 3)} />
            <BytesEntry desc="private_bits" value={toBinary(sideinfo.private_bits, sideinfo.channel.length === 1 ? 5 : 3)} />
        </BytesSection>
        {
            sideinfo.channel.map((ch, ch_i) => <BytesSection key={ch_i} color="#fdf" title={`sideinfo scalefactor selection information: channel ${ch_i}`}>
                {ch.scfsi.map((sfb, sfb_i) => <BytesEntry key={sfb_i} desc={`scfsi_band ${["0..5", "6..10", "11..15", "16..20"][sfb_i]}`} value={`${sfb} (${sfb ? "copy-from-granule-0" : "transmitted"})`} />)}
            </BytesSection>)
        }
        {
            [0, 1].map(gr =>
                <>
                    <SideinfoBytesOne key={`${gr}_0`} sideinfo={sideinfo} gr={gr} ch={0} />
                    {1 < sideinfo.channel.length && <SideinfoBytesOne key={`${gr}_1`} sideinfo={sideinfo} gr={gr} ch={1} />}
                </>
            )
        }
    </>;

export function FrameBytes({ parsedFrame }: { parsedFrame: ParsedFrame | null; }) {
    return parsedFrame === null
        ? <></>
        : <>
            <div>File offset: {parsedFrame.frame.offset}</div>
            <HeaderBytes header={parsedFrame.frame.header} />
            {parsedFrame.frame.crc_check === null
                ? null
                : <BytesSection color="#dbd" title="error check">
                    <BytesEntry desc="crc_check" value={toHex(parsedFrame.frame.crc_check, 4)} />
                </BytesSection>}
            <SideinfoBytes sideinfo={parsedFrame.frame.sideinfo} />
        </>;
}

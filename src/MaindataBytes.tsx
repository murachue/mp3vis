import React from 'react';
import { BytesEntry, BytesSection, BytesBox } from "./Bytes";
import { Maindata, scalefac_compress_tab, Sideinfo } from './libmp3';
import { times, range } from 'lodash-es';

const maindataScalefac = ({ sideinfo, maindata, gr, ch, offset, hiOffset, onClick }: { sideinfo: Sideinfo; maindata: Maindata, gr: number, ch: number; offset: number; hiOffset: number | null; onClick: (offset: number, bits: number) => void; }) => {
    const sideinfo_gr_ch = sideinfo.channel[ch].granule[gr];
    const raw_scalefac = maindata.granule[gr].channel[ch].raw_scalefac;
    const scalefac = maindata.granule[gr].channel[ch].scalefac;
    const [slen1, slen2] = scalefac_compress_tab[sideinfo_gr_ch.scalefac_compress];
    switch (scalefac.type) {
        case "long": {
            const lens_org = [...range(0, 10 + 1).map(_ => slen1), ...range(11, 20 + 1).map(_ => slen2)];
            const lens = lens_org.map((len, i) => isNaN(raw_scalefac.scalefac_l![i]) ? 0 : len); // filter out omitted
            const offsets = lens.reduce((prev, cur) => [...prev, prev[prev.length - 1] + cur], [0]);
            return {
                offset: offsets[offsets.length - 1],
                elements: scalefac.scalefac_l.map((sf, i) => <BytesEntry key={i} desc={`long[${i}]`} offset={offset + offsets[i]} bits={lens[i]} value={isNaN(raw_scalefac.scalefac_l![i]) ? `(${sf}) (copied)` : `${sf} (${lens[i]} bits)`} hiOffset={hiOffset} onClick={onClick} />),
            };
        }
        case "short": {
            const lens = [...range(0, 5 + 1).map(_ => slen1), ...range(6, 11 + 1).map(_ => slen2)];
            const offsets = lens.reduce((prev, cur) => [...prev, prev[prev.length - 1] + cur * 3], [0]);
            return {
                offset: offsets[offsets.length - 1],
                elements: scalefac.scalefac_s.flatMap((sfs, i) =>
                    sfs.map((sf, w_i) => <BytesEntry key={`${i}_${w_i}`} desc={`short[${i}][${w_i}]`} offset={offset + offsets[i] + lens[i] * w_i} bits={lens[i]} value={`${sf} (${lens[i]} bits)`} hiOffset={hiOffset} onClick={onClick} />)
                ),
            };
        }
        case "mixed": {
            const lens_long = [...range(0, 7 + 1).map(_ => slen1)];
            const lens_short = [...range(0, 3).map(_ => 0), ...range(3, 5 + 1).map(_ => slen1), ...range(6, 11 + 1).map(_ => slen2)];
            const offsets_long = lens_long.reduce((prev, cur) => [...prev, prev[prev.length - 1] + cur], [0]);
            const offsets_short = lens_short.reduce((prev, cur) => [...prev, prev[prev.length - 1] + cur * 3], [offsets_long[offsets_long.length - 1]]);
            return {
                offset: offsets_short[offsets_short.length - 1],
                elements:
                    scalefac.scalefac_l.map((sf, i) => <BytesEntry key={`long_${i}`} desc={`long[${i}]`} offset={offset + offsets_long[i]} bits={lens_long[i]} value={`${sf} (${lens_long[i]} bits)`} hiOffset={hiOffset} onClick={onClick} />)
                        .concat(scalefac.scalefac_s.flatMap((sfs, i) =>
                            sfs.map((sf, w_i) => <BytesEntry key={`short_${i}_${w_i}`} desc={`short[${i}][${w_i}]`} offset={offset + offsets_short[i] + lens_short[i] * w_i} bits={lens_short[i]} value={`${sf} (${lens_short[i]} bits)`} hiOffset={hiOffset} onClick={onClick} />)
                        )),
            };
        }
    }
};

const maindataHuffman = ({ sideinfo, maindata, gr, ch, offset, hiOffset, onClick }: { sideinfo: Sideinfo; maindata: Maindata, gr: number, ch: number; offset: number; hiOffset: number | null; onClick: (offset: number, bits: number) => void; }) => {
    const maindata_gr_ch = maindata.granule[gr].channel[ch];
    const elements = [];
    const bigs = maindata_gr_ch.is.bigs;
    for (const [big, i] of bigs.map((big, i) => [big, i] as const)) {
        elements.push(<BytesEntry key={`pair_${i}`} desc={`big.pair[${i * 2},${i * 2 + 1}]`} offset={offset} bits={big.huffbits.length} value={`${big.huffbits} (${big.value.map(e => Math.min(15, Math.abs(e)))})`} hiOffset={hiOffset} onClick={onClick} />);
        offset += big.huffbits.length;
        for (const [one, p_i] of big.pairbits.map((one, p_i) => [one, p_i] as const)) {
            if (one.linbits) {
                elements.push(<BytesEntry key={`linbits_${i}_${p_i}`} desc={`big.linbits[${i * 2 + p_i}]`} offset={offset} bits={one.linbits.length} value={`+${Math.abs(one.value) - 15}`} hiOffset={hiOffset} onClick={onClick} />);
                offset += one.linbits.length;
            }
            if (one.sign) {
                elements.push(<BytesEntry key={`sign_${i}_${p_i}`} desc={`big.sign[${i * 2 + p_i}]`} offset={offset} bits={one.sign.length} value={`${one.sign} (-> ${one.value})`} hiOffset={hiOffset} onClick={onClick} />);
                offset += one.sign.length;
            }
        }
    }
    return {
        elements,
        offset,
    };
};

export const MaindataBytes = ({ sideinfo, maindata, hiOffset, onClick }: { sideinfo: Sideinfo | null, maindata: Maindata | null; hiOffset: number | null; onClick: (offset: number, bits: number) => void; }) => {
    if (!sideinfo || !maindata) {
        return <></>;
    }

    const sections = [];
    let offset = 0;

    for (const ch of times(sideinfo.channel.length)) {
        for (const gr of times(2)) {
            const result = maindataScalefac({ sideinfo, maindata, gr, ch, offset, hiOffset, onClick });
            sections.push(<BytesSection key={`${ch}_${gr}`} color="#eee" title={`scalefactors channel ${ch} granule ${gr}`}>{result.elements}</BytesSection>);
            offset += result.offset;
        }
    }

    for (const ch of times(sideinfo.channel.length)) {
        for (const gr of times(2)) {
            const result = maindataHuffman({ sideinfo, maindata, gr, ch, offset, hiOffset, onClick });
            sections.push(<BytesSection key={`${ch}_${gr}`} color="#eee" title={`huffmans channel ${ch} granule ${gr}`}>{result.elements}</BytesSection>);
            offset += result.offset;
        }
    }

    return <BytesBox>
        {sections}
    </BytesBox>;
};

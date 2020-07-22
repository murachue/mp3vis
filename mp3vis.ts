import { times, range } from "lodash-es";

// https://log.pocka.io/posts/typescript-promisetype/
type PromiseType<T extends Promise<any>> = T extends Promise<infer P>
    ? P
    : never;

// bslbf/uimsbf reader
class U8BitReader {
    u8: Uint8Array;
    atebits: number;
    bits: number;
    bypos: number;

    constructor(u8: Uint8Array) {
        this.u8 = u8;
        // tsc does not recognize if using #seek. or calling method in ctor is invalid?
        // this.seek(0);
        this.bypos = -1;
        this.atebits = 8;
        this.bits = 0;
    }
    async readbits(nbits: number) {
        let b = 0;
        while (0 < nbits) {
            if (8 <= this.atebits) {
                if (this.eof()) {
                    // even if partial read succeeds.
                    throw new Error("!eof");
                }
                this.bypos += 1;
                this.bits = this.u8[this.bypos];
                this.atebits = 0;
            }
            const r = Math.min(8 - this.atebits, nbits);
            b = (b << r) | ((this.bits >> (8 - r - this.atebits)) & ((1 << r) - 1));
            this.atebits += r;
            nbits -= r;
        }
        return b;
    }
    async readbytes(nbytes: number) {
        if (this.atebits !== 8) {
            throw new Error(`not byte boundary tell=${this.tell()}`);
        }
        const nrb = Math.min(this.u8.length - this.bypos - 1, nbytes);
        const bys = this.u8.slice(this.bypos + 1, this.bypos + 1 + nrb);
        this.bypos += nrb;
        if (nrb < nbytes) {
            // even if partial read succeeds.
            throw new Error("!eof");
        }
        return bys;
    }
    seek(bipos: number) {
        bipos = Math.min(bipos, this.u8.length * 8);
        this.bypos = Math.floor(bipos / 8);
        this.atebits = bipos % 8;
        if (this.atebits === 0) {
            this.atebits = 8;
            this.bypos = this.bypos - 1;
        }
        this.bits = this.u8[this.bypos];
    }
    tell() {
        return this.bypos * 8 + this.atebits;
    }
    eof() {
        return this.u8.length <= this.bypos + 1;
    }
    get length() {
        return this.u8.length * 8;
    }
}

async function readheader(r: U8BitReader) {
    const syncword = await r.readbits(12);
    if (syncword !== 0xFFF) {
        throw new Error("!sync");
    }
    const id = await r.readbits(1); // 1==MPEG_Audio
    if (id === 0) {
        throw new Error("!id");
    }
    const layer = await r.readbits(2); // 11=layer1 10=layer2 01=layer3
    if (layer === 0) {
        throw new Error("!layer");
    }
    const protection_bit = await r.readbits(1); // 0=redundancy_added
    const bitrate_index = await r.readbits(4);
    const sampling_frequency = await r.readbits(2); // 00=44.1k 01=48k 10=32k
    if (sampling_frequency === 3) {
        throw new Error("!sampfreq");
    }
    const padding_bit = await r.readbits(1); // 1=padding_added
    const private_bit = await r.readbits(1);
    const mode = await r.readbits(2); // 00=stereo 01=joint_stereo(MS/IS) 10=dual_channel 11=single_channel
    const mode_extension = await r.readbits(2); // Layer3: (msb)MSon|ISon(lsb)
    const copyright = await r.readbits(1); // 1=copyright_protected
    const original = await r.readbits(1); // 1=original
    const emphasis = await r.readbits(2); // 00=noemph 01=50/15us 10=reserved 11=CCITT_J.17
    if (emphasis === 2) {
        throw new Error("!emph");
    }

    return {
        syncword,
        id,
        layer,
        protection_bit,
        bitrate_index,
        sampling_frequency,
        padding_bit,
        private_bit,
        mode,
        mode_extension,
        copyright,
        original,
        emphasis,
    };
};

async function readlayer3sideinfo(r: U8BitReader, header: PromiseType<ReturnType<typeof readheader>>) {
    const is_mono = header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const main_data_end = await r.readbits(9); // means this frame needs this more bytes from previous last
    const private_bits = await r.readbits(is_mono ? 5 : 3);
    // note: scfsi just for long windows.
    const scfsi = [];
    for (const ch of times(nchans)) {
        const scfsi_ch = [];
        for (const band of times(4)) { // for bands 0..5, 6..10, 11..15, 16..20 (note: only first is 6 elms not 5!)
            scfsi_ch.push(await r.readbits(1));
        }
        scfsi.push(scfsi_ch);
    }

    const part2_3_length = [];
    const big_values = [];
    const global_gain = [];
    const scalefac_compress = [];
    const block = [];
    const preflag = [];
    const scalefac_scale = [];
    const count1table_select = [];

    for (const gr of times(2)) {
        const part2_3_length_gr = [];
        const big_values_gr = [];
        const global_gain_gr = [];
        const scalefac_compress_gr = [];
        const block_gr = [];
        const preflag_gr = [];
        const scalefac_scale_gr = [];
        const count1table_select_gr = [];
        for (const ch of times(nchans)) {
            part2_3_length_gr.push(await r.readbits(12));
            big_values_gr.push(await r.readbits(9));
            global_gain_gr.push(await r.readbits(8));
            scalefac_compress_gr.push(await r.readbits(4));
            const blocksplit_flag_gr_ch = await r.readbits(1);
            // both are 22bits
            if (blocksplit_flag_gr_ch) {
                // non-normal window
                const block_type_gr_ch = await r.readbits(2);
                const switch_point_gr_ch = await r.readbits(1);
                const table_select_gr_ch = [];
                for (const region of times(2)) {
                    table_select_gr_ch.push(await r.readbits(5));
                }
                const subblock_gain_gr_ch = [];
                for (const window of times(3)) {
                    subblock_gain_gr_ch.push(await r.readbits(3));
                }

                if (block_type_gr_ch === 0) {
                    throw new Error("!reserved:inconsistency-normal-window blocksplit_flag=1 but block_type=0");
                }

                if (switch_point_gr_ch === 1 && block_type_gr_ch !== 2) {
                    // it seems...
                    throw new Error(`!ReadTheF*ckingSpec: switch_point become 1 only if block_type is 2 but ${block_type_gr_ch}`);
                }

                // they from Lagerstrom MP3 Thesis
                const region_address1_gr_ch = (block_type_gr_ch === 2 && switch_point_gr_ch === 0) ? 8 : 7;
                const region_address2_gr_ch = 20 - region_address1_gr_ch;

                block_gr.push({
                    block_split_flag: true, // window_switch(ing)?
                    block_type: block_type_gr_ch,
                    switch_point: switch_point_gr_ch, // mixed_block?
                    table_select: table_select_gr_ch,
                    subblock_gain: subblock_gain_gr_ch,
                    region_address1: region_address1_gr_ch,
                    region_address2: region_address2_gr_ch,
                } as const);
            } else {
                // normal window
                const table_select_gr_ch = [];
                for (const region of times(3)) {
                    table_select_gr_ch.push(await r.readbits(5));
                }
                const region_address1_gr_ch = await r.readbits(4);
                const region_address2_gr_ch = await r.readbits(3);

                block_gr.push({
                    block_split_flag: false, // window_switch?
                    block_type: 0,
                    switch_point: null, // mixed_block?
                    table_select: table_select_gr_ch,
                    subblock_gain: null,
                    region_address1: region_address1_gr_ch,
                    region_address2: region_address2_gr_ch,
                } as const);
            }
            preflag_gr.push(await r.readbits(1));
            scalefac_scale_gr.push(await r.readbits(1));
            count1table_select_gr.push(await r.readbits(1));
        }

        part2_3_length.push(part2_3_length_gr);
        big_values.push(big_values_gr);
        global_gain.push(global_gain_gr);
        scalefac_compress.push(scalefac_compress_gr);
        block.push(block_gr);
        preflag.push(preflag_gr);
        scalefac_scale.push(scalefac_scale_gr);
        count1table_select.push(count1table_select_gr);
    }

    return {
        // per frame
        main_data_end, // in "bytes"
        private_bits,

        // per [ch]
        scfsi, // SCaleFactor Selection Information

        // per [gr][ch]
        part2_3_length, // in "bits"
        big_values,
        global_gain,
        scalefac_compress,
        block,
        preflag,
        scalefac_scale,
        count1table_select,
    };
};

async function readframe(r: U8BitReader) {
    const offset = r.tell() / 8;
    const header = await readheader(r);
    const crc_check = (header.protection_bit === 0) ? await r.readbits(16) : null;
    if (header.layer != 1) { // layer3
        throw new Error("!not-layer3");
    }
    const sideinfo = await readlayer3sideinfo(r, header);
    // note: it seems here becomes byte-boundary. spec carefully made? (using private_bits as padding)

    if (header.bitrate_index === 0) {
        throw new Error("free-format not supported yet");
    }
    const headbytes = r.tell() / 8 - offset;
    const l3bitratekbps = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][header.bitrate_index - 1];
    const sampfreq = [44100, 48000, 32000][header.sampling_frequency];
    // TODO: how to measure framebytes in free-format? try to read next sync and then read?? difficult on buffering...
    // const framebytes = sampfreq/1152/* 2granules */;
    const framebytes = Math.floor(144 * l3bitratekbps * 1000 / sampfreq) + header.padding_bit; // from Lagerstrom MP3 Thesis, but what is 144?
    const data = await r.readbytes(framebytes - headbytes);
    return {
        offset,
        header,
        crc_check,
        sideinfo,
        data, // not main_data that is reassembled.
    };
};

// https://stackoverflow.com/a/35633935
function concat<T extends Uint8Array>(a: T, b: T) {
    const x = new (a.constructor as any)(a.length + b.length);
    x.set(a);
    x.set(b, a.length);
    return x;
}

// note: this will return more than enough on tail.
function get_main_data(prevframes: PromiseType<ReturnType<typeof readframe>>[], frame: PromiseType<ReturnType<typeof readframe>>) {
    // ugly but can't flatMap to Uint8Array...
    const reservoir = prevframes.map(f => f.data).reduce((p, c) => concat(p, c), new Uint8Array());
    if (reservoir.length < frame.sideinfo.main_data_end) {
        // not enough reservoir (started in middle of stream?), can't decode
        return null;
    }

    return concat(reservoir.slice(-frame.sideinfo.main_data_end), frame.data);
}

const count1Hufftab0: readonly any[] = [[[[[[[1, 0, 1, 1], [1, 1, 1, 1]], [[1, 1, 0, 1], [1, 1, 1, 0]]], [[[0, 1, 1, 1], [0, 1, 0, 1]], [1, 0, 0, 1]]], [[[0, 1, 1, 0], [0, 0, 1, 1]], [[1, 0, 1, 0], [1, 1, 0, 0]]]], [[[0, 0, 1, 0], [0, 0, 0, 1]], [[0, 1, 0, 0], [1, 0, 0, 0]]]], [0, 0, 0, 0]];
const count1Hufftab1: readonly any[] = [[[[[1, 1, 1, 1], [1, 1, 1, 0]], [[1, 1, 0, 1], [1, 1, 0, 0]]], [[[1, 0, 1, 1], [1, 0, 1, 0]], [[1, 0, 0, 1], [1, 0, 0, 0]]]], [[[[0, 1, 1, 1], [0, 1, 1, 0]], [[0, 1, 0, 1], [0, 1, 0, 0]]], [[[0, 0, 1, 1], [0, 0, 1, 0]], [[0, 0, 0, 1], [0, 0, 0, 0]]]]];
const bigvalueHufftab1: readonly any[] = [[[[1, 1], [0, 1]], [1, 0]], [0, 0]];
const bigvalueHufftab2: readonly any[] = [[[[[[[2, 2], [0, 2]], [1, 2]], [[2, 1], [2, 0]]], [1, 1]], [[0, 1], [1, 0]]], [0, 0]];
const bigvalueHufftab3: readonly any[] = [[[[[[[2, 2], [0, 2]], [1, 2]], [[2, 1], [2, 0]]], [1, 0]], [1, 1]], [[0, 1], [0, 0]]];
const bigvalueHufftab5: readonly any[] = [[[[[[[[[3, 3], [2, 3]], [3, 2]], [3, 1]], [[[1, 3], [0, 3]], [[3, 0], [2, 2]]]], [[[1, 2], [2, 1]], [[0, 2], [2, 0]]]], [1, 1]], [[0, 1], [1, 0]]], [0, 0]];
const bigvalueHufftab6: readonly any[] = [[[[[[[[3, 3], [0, 3]], [2, 3]], [[3, 2], [3, 0]]], [[1, 3], [3, 1]]], [[[2, 2], [0, 2]], [1, 2]]], [[[2, 1], [2, 0]], [0, 1]]], [[1, 1], [[1, 0], [0, 0]]]];
const bigvalueHufftab7: readonly any[] = [[[[[[[[[[[5, 5], [4, 5]], [[5, 4], [5, 3]]], [[3, 5], [4, 4]]], [[[2, 5], [5, 2]], [1, 5]]], [[[5, 1], [[0, 5], [3, 4]]], [[5, 0], [[4, 3], [3, 3]]]]], [[[[2, 4], [4, 2]], [1, 4]], [[4, 1], [4, 0]]]], [[[[[0, 4], [2, 3]], [[3, 2], [0, 3]]], [[1, 3], [3, 1]]], [[[3, 0], [2, 2]], [1, 2]]]], [[[2, 1], [[0, 2], [2, 0]]], [1, 1]]], [[0, 1], [1, 0]]], [0, 0]];
const bigvalueHufftab8: readonly any[] = [[[[[[[[[[[[5, 5], [5, 4]], [4, 5]], [5, 3]], [[[3, 5], [4, 4]], [2, 5]]], [[[5, 2], [0, 5]], [1, 5]]], [[[5, 1], [[3, 4], [4, 3]]], [[[5, 0], [3, 3]], [2, 4]]]], [[[[4, 2], [1, 4]], [4, 1]], [[[0, 4], [4, 0]], [[2, 3], [3, 2]]]]], [[[[[1, 3], [3, 1]], [[0, 3], [3, 0]]], [2, 2]], [[0, 2], [2, 0]]]], [[1, 2], [2, 1]]], [1, 1]], [[[0, 1], [1, 0]], [0, 0]]];
const bigvalueHufftab9: readonly any[] = [[[[[[[[[[5, 5], [4, 5]], [3, 5]], [[5, 3], [[5, 4], [0, 5]]]], [[[4, 4], [2, 5]], [[5, 2], [1, 5]]]], [[[5, 1], [3, 4]], [[4, 3], [[5, 0], [0, 4]]]]], [[[[2, 4], [4, 2]], [[3, 3], [4, 0]]], [[1, 4], [4, 1]]]], [[[[2, 3], [3, 2]], [1, 3]], [[3, 1], [[0, 3], [3, 0]]]]], [[[[2, 2], [0, 2]], [1, 2]], [[2, 1], [2, 0]]]], [[[1, 1], [0, 1]], [[1, 0], [0, 0]]]];
const bigvalueHufftab10: readonly any[] = [[[[[[[[[[[[7, 7], [6, 7]], [[7, 6], [5, 7]]], [[[7, 5], [6, 6]], [4, 7]]], [[[7, 4], [5, 6]], [[6, 5], [3, 7]]]], [[[[7, 3], [4, 6]], [[[5, 5], [5, 4]], [6, 3]]], [[2, 7], [7, 2]]]], [[[[[6, 4], [0, 7]], [7, 0]], [[6, 2], [[4, 5], [3, 5]]]], [[[0, 6], [[5, 3], [4, 4]]], [1, 7]]]], [[[[7, 1], [[3, 6], [2, 6]]], [[[[2, 5], [5, 2]], [1, 5]], [[5, 1], [[3, 4], [4, 3]]]]], [[[1, 6], [6, 1]], [[6, 0], [[0, 5], [5, 0]]]]]], [[[[[[2, 4], [4, 2]], [[3, 3], [0, 4]]], [[1, 4], [4, 1]]], [[[4, 0], [2, 3]], [[3, 2], [0, 3]]]], [[[1, 3], [3, 1]], [[3, 0], [2, 2]]]]], [[[[1, 2], [2, 1]], [[0, 2], [2, 0]]], [1, 1]]], [[0, 1], [1, 0]]], [0, 0]];
const bigvalueHufftab11: readonly any[] = [[[[[[[[[[[7, 7], [6, 7]], [[7, 6], [7, 5]]], [[[6, 6], [4, 7]], [[7, 4], [[5, 7], [5, 5]]]]], [[[[5, 6], [6, 5]], [3, 7]], [[7, 3], [4, 6]]]], [[[[[4, 5], [5, 4]], [[3, 5], [5, 3]]], [2, 7]], [[7, 2], [[6, 4], [0, 7]]]]], [[[7, 1], [[1, 7], [7, 0]]], [[[3, 6], [6, 3]], [[6, 0], [[4, 4], [2, 5]]]]]], [[[[[[5, 2], [0, 5]], [1, 5]], [6, 2]], [[[2, 6], [0, 6]], [1, 6]]], [[[6, 1], [[5, 1], [3, 4]]], [[[5, 0], [[4, 3], [3, 3]]], [[2, 4], [4, 2]]]]]], [[[[[[1, 4], [4, 1]], [[0, 4], [4, 0]]], [[2, 3], [3, 2]]], [[1, 3], [3, 1]]], [[[[0, 3], [3, 0]], [2, 2]], [2, 1]]]], [[[1, 2], [[0, 2], [2, 0]]], [1, 1]]], [[[0, 1], [1, 0]], [0, 0]]];
const bigvalueHufftab12: readonly any[] = [[[[[[[[[[[7, 7], [6, 7]], [7, 6]], [[5, 7], [7, 5]]], [[[6, 6], [4, 7]], [[7, 4], [6, 5]]]], [[[5, 6], [3, 7]], [[[7, 3], [5, 5]], [2, 7]]]], [[[[7, 2], [4, 6]], [[6, 4], [1, 7]]], [[[7, 1], [[0, 7], [7, 0]]], [[3, 6], [6, 3]]]]], [[[[[4, 5], [5, 4]], [[4, 4], [[0, 6], [0, 5]]]], [[2, 6], [6, 2]]], [[[6, 1], [[1, 6], [6, 0]]], [[[3, 5], [5, 3]], [[2, 5], [5, 2]]]]]], [[[[[1, 5], [5, 1]], [[3, 4], [4, 3]]], [[[[5, 0], [0, 4]], [2, 4]], [[4, 2], [1, 4]]]], [[[3, 3], [4, 1]], [[2, 3], [3, 2]]]]], [[[[[[4, 0], [0, 3]], [3, 0]], [1, 3]], [[3, 1], [2, 2]]], [[1, 2], [2, 1]]]], [[[[[0, 2], [2, 0]], [0, 0]], [1, 1]], [[0, 1], [1, 0]]]];
const bigvalueHufftab13: readonly any[] = [[[[[[[[[[[[[[[[[[[[15, 14], [15, 12]], [15, 13]], [14, 13]], [15, 15]], [[14, 15], [13, 15]]], [[[14, 14], [12, 15]], [[13, 14], [11, 15]]]], [[[[15, 11], [12, 14]], [[13, 12], [[10, 15], [14, 9]]]], [[14, 12], [13, 13]]]], [[[[[15, 10], [12, 13]], [11, 14]], [[14, 11], [9, 15]]], [[[15, 9], [14, 10]], [[11, 13], [13, 11]]]]], [[[[[8, 15], [15, 8]], [[12, 12], [[10, 14], [9, 14]]]], [[[8, 14], [[7, 15], [7, 14]]], [15, 7]]], [[[13, 10], [[10, 13], [11, 12]]], [[[12, 11], [15, 6]], [6, 15]]]]], [[[[[14, 8], [5, 15]], [[9, 13], [13, 9]]], [[[15, 5], [14, 7]], [[10, 12], [11, 11]]]], [[[[4, 15], [15, 4]], [[[12, 10], [14, 6]], [15, 3]]], [[3, 15], [[8, 13], [13, 8]]]]]], [[[[[2, 15], [15, 2]], [[[6, 14], [9, 12]], [0, 15]]], [[[[12, 9], [5, 14]], [10, 11]], [[[7, 13], [13, 7]], [4, 14]]]], [[[[[12, 8], [13, 6]], [3, 14]], [[11, 9], [[9, 11], [10, 10]]]], [[1, 15], [15, 1]]]]], [[[[[15, 0], [[11, 10], [14, 5]]], [[[14, 4], [8, 12]], [[6, 13], [14, 3]]]], [[[14, 2], [[2, 14], [0, 14]]], [[1, 14], [14, 1]]]], [[[[[14, 0], [5, 13]], [[13, 5], [7, 12]]], [[[12, 7], [4, 13]], [[8, 11], [11, 8]]]], [[[[13, 4], [9, 10]], [[10, 9], [6, 12]]], [[12, 6], [3, 13]]]]]], [[[[[[[13, 3], [7, 11]], [2, 13]], [[13, 2], [1, 13]]], [[[11, 7], [[5, 12], [12, 5]]], [[[9, 9], [7, 10]], [12, 3]]]], [[[[[10, 7], [9, 7]], [4, 11]], [13, 1]], [[[0, 13], [13, 0]], [[8, 10], [10, 8]]]]], [[[[[4, 12], [12, 4]], [[6, 11], [11, 6]]], [[3, 12], [2, 12]]], [[[12, 2], [5, 11]], [[[11, 5], [8, 9]], [1, 12]]]]]], [[[[[[12, 1], [[9, 8], [0, 12]]], [[12, 0], [[11, 4], [6, 10]]]], [[[[10, 6], [7, 9]], [3, 11]], [[11, 3], [[8, 8], [5, 10]]]]], [[[[2, 11], [[10, 5], [6, 9]]], [[10, 4], [[7, 8], [8, 7]]]], [[[9, 4], [[7, 7], [7, 6]]], [11, 2]]]], [[[[1, 11], [11, 1]], [[[0, 11], [11, 0]], [[9, 6], [4, 10]]]], [[[[3, 10], [10, 3]], [[5, 9], [9, 5]]], [[2, 10], [10, 2]]]]]], [[[[[[1, 10], [10, 1]], [[[0, 10], [6, 8]], [10, 0]]], [[[[8, 6], [4, 9]], [9, 3]], [[[3, 9], [5, 8]], [[8, 5], [6, 7]]]]], [[[[2, 9], [9, 2]], [[[5, 7], [7, 5]], [3, 8]]], [[[8, 3], [[6, 6], [4, 7]]], [[[7, 4], [5, 6]], [[6, 5], [7, 3]]]]]], [[[[1, 9], [9, 1]], [[[0, 9], [9, 0]], [[4, 8], [8, 4]]]], [[[[7, 2], [[4, 6], [6, 4]]], [2, 8]], [[8, 2], [1, 8]]]]]], [[[[[[[3, 7], [2, 7]], [1, 7]], [[7, 1], [[5, 5], [0, 7]]]], [[[[7, 0], [3, 6]], [[6, 3], [4, 5]]], [[[5, 4], [2, 6]], [[6, 2], [3, 5]]]]], [[[8, 1], [[0, 8], [8, 0]]], [[[1, 6], [6, 1]], [[0, 6], [6, 0]]]]], [[[[[[5, 3], [4, 4]], [2, 5]], [[5, 2], [0, 5]]], [[1, 5], [5, 1]]], [[[[3, 4], [4, 3]], [[5, 0], [2, 4]]], [[[4, 2], [3, 3]], [1, 4]]]]]], [[[[[4, 1], [[0, 4], [4, 0]]], [[[2, 3], [3, 2]], [1, 3]]], [[[3, 1], [0, 3]], [[3, 0], [2, 2]]]], [[[1, 2], [2, 1]], [[0, 2], [2, 0]]]]], [[[1, 1], [0, 1]], [1, 0]]], [0, 0]];
const bigvalueHufftab15: readonly any[] = [[[[[[[[[[[[[[15, 15], [14, 15]], [[15, 14], [13, 15]]], [[14, 14], [[15, 13], [12, 15]]]], [[[[15, 12], [13, 14]], [[14, 13], [11, 15]]], [[15, 11], [[12, 14], [14, 12]]]]], [[[[13, 13], [10, 15]], [[15, 10], [11, 14]]], [[[14, 11], [12, 13]], [[13, 12], [9, 15]]]]], [[[[[15, 9], [14, 10]], [[11, 13], [13, 11]]], [[[8, 15], [15, 8]], [[12, 12], [9, 14]]]], [[[[14, 9], [7, 15]], [[15, 7], [10, 13]]], [[[13, 10], [11, 12]], [[6, 15], [[10, 14], [0, 15]]]]]]], [[[[[12, 11], [15, 6]], [[[8, 14], [14, 8]], [[5, 15], [9, 13]]]], [[[15, 5], [7, 14]], [[14, 7], [10, 12]]]], [[[[12, 10], [11, 11]], [[[13, 9], [8, 13]], [4, 15]]], [[[15, 4], [3, 15]], [[15, 3], [13, 8]]]]]], [[[[[[14, 6], [2, 15]], [[15, 2], [[6, 14], [15, 0]]]], [[[1, 15], [15, 1]], [[9, 12], [12, 9]]]], [[[[5, 14], [10, 11]], [[11, 10], [14, 5]]], [[[7, 13], [13, 7]], [[4, 14], [14, 4]]]]], [[[[[8, 12], [12, 8]], [[3, 14], [6, 13]]], [[[13, 6], [14, 3]], [[9, 11], [11, 9]]]], [[[[2, 14], [10, 10]], [[14, 2], [1, 14]]], [[[14, 1], [[0, 14], [14, 0]]], [[5, 13], [13, 5]]]]]]], [[[[[[[7, 12], [12, 7]], [[4, 13], [8, 11]]], [[13, 4], [[11, 8], [9, 10]]]], [[[[10, 9], [6, 12]], [[12, 6], [3, 13]]], [[13, 3], [13, 2]]]], [[[[[2, 13], [0, 13]], [1, 13]], [[7, 11], [11, 7]]], [[[13, 1], [[5, 12], [13, 0]]], [[12, 5], [8, 10]]]]], [[[[[10, 8], [4, 12]], [[12, 4], [6, 11]]], [[[11, 6], [[9, 9], [0, 12]]], [[3, 12], [12, 3]]]], [[[[7, 10], [10, 7]], [[10, 6], [[12, 0], [0, 11]]]], [[12, 2], [[2, 12], [5, 11]]]]]]], [[[[[[[11, 5], [1, 12]], [[8, 9], [9, 8]]], [[[12, 1], [4, 11]], [[11, 4], [6, 10]]]], [[[[3, 11], [7, 9]], [11, 3]], [[[9, 7], [8, 8]], [[2, 11], [5, 10]]]]], [[[[11, 2], [[10, 5], [1, 11]]], [[11, 1], [[11, 0], [6, 9]]]], [[[[9, 6], [4, 10]], [[10, 4], [7, 8]]], [[[8, 7], [3, 10]], [10, 3]]]]], [[[[[5, 9], [9, 5]], [[2, 10], [10, 2]]], [[[1, 10], [10, 1]], [[[0, 10], [10, 0]], [6, 8]]]], [[[[8, 6], [4, 9]], [[9, 4], [3, 9]]], [[[9, 3], [[7, 7], [0, 9]]], [[5, 8], [8, 5]]]]]]], [[[[[[[2, 9], [6, 7]], [[7, 6], [9, 2]]], [[9, 1], [[1, 9], [9, 0]]]], [[[[4, 8], [8, 4]], [[5, 7], [7, 5]]], [[[3, 8], [8, 3]], [[6, 6], [4, 7]]]]], [[[[2, 8], [8, 2]], [[1, 8], [8, 1]]], [[[[7, 4], [0, 8]], [[8, 0], [5, 6]]], [[[6, 5], [3, 7]], [[7, 3], [4, 6]]]]]], [[[[[2, 7], [7, 2]], [[6, 4], [1, 7]]], [[[5, 5], [7, 1]], [[[0, 7], [7, 0]], [3, 6]]]], [[[[6, 3], [4, 5]], [[5, 4], [2, 6]]], [[[6, 2], [1, 6]], [[[0, 6], [6, 0]], [3, 5]]]]]]], [[[[[[6, 1], [[5, 3], [4, 4]]], [[2, 5], [5, 2]]], [[[1, 5], [5, 1]], [[[0, 5], [5, 0]], [3, 4]]]], [[[[4, 3], [2, 4]], [[4, 2], [3, 3]]], [[4, 1], [[1, 4], [0, 4]]]]], [[[[2, 3], [3, 2]], [[[4, 0], [0, 3]], [1, 3]]], [[[3, 1], [3, 0]], [2, 2]]]]], [[[[[1, 2], [2, 1]], [[0, 2], [2, 0]]], [1, 1]], [[[0, 1], [1, 0]], [0, 0]]]];
const bigvalueHufftab16: readonly any[] = [[[[[[[[[[[[14, 15], [15, 14]], [[13, 15], [15, 13]]], [[[12, 15], [15, 12]], [[11, 15], [15, 11]]]], [[[10, 15], [[15, 10], [9, 15]]], [[[15, 9], [15, 8]], [8, 15]]]], [[[[7, 15], [15, 7]], [[6, 15], [15, 6]]], [15, 15]]], [[[[[5, 15], [15, 5]], [4, 15]], [[15, 4], [15, 3]]], [[[15, 0], [[3, 15], [[[[[[[12, 14], [[14, 12], [13, 13]]], [13, 14]], [[14, 9], [[14, 10], [13, 9]]]], [[14, 14], [[14, 13], [14, 11]]]], [[[11, 14], [12, 13]], [[[13, 12], [13, 11]], [10, 14]]]], [[[[12, 12], [[10, 13], [13, 10]]], [[[7, 14], [10, 12]], [12, 10]]], [[[[12, 9], [7, 13]], [5, 14]], [11, 13]]]]]], [15, 2]]]], [[[[[2, 15], [0, 15]], [1, 15]], [[15, 1], [[[[[[9, 14], [[11, 12], [12, 11]]], [[[8, 14], [14, 8]], [[9, 13], [14, 7]]]], [[[[11, 11], [8, 13]], [[13, 8], [6, 14]]], [[14, 6], [9, 12]]]], [[[[[10, 11], [11, 10]], [[14, 5], [13, 7]]], [[4, 14], [[14, 4], [8, 12]]]], [[[12, 8], [3, 14]], [[6, 13], [[13, 6], [9, 11]]]]]], [[[[[[11, 9], [10, 10]], [14, 1]], [[13, 4], [[11, 8], [10, 9]]]], [[[7, 11], [[11, 7], [13, 0]]], [14, 3]]], [[[[0, 14], [14, 0]], [[5, 13], [13, 5]]], [[[7, 12], [12, 7]], [[4, 13], [8, 11]]]]]]]], [[[[[[[[9, 10], [6, 12]], [[12, 6], [3, 13]]], [[[5, 12], [12, 5]], [0, 13]]], [[[[8, 10], [10, 8]], [[9, 9], [4, 12]]], [[[11, 6], [7, 10]], [3, 12]]]], [[[[[5, 11], [8, 9]], [1, 12]], [[12, 0], [[9, 8], [7, 9]]]], [[14, 2], [[2, 14], [1, 14]]]]], [[[[[13, 3], [2, 13]], [[13, 2], [13, 1]]], [[[3, 11], [[9, 7], [8, 8]]], [1, 13]]], [[[[12, 4], [6, 11]], [[12, 3], [10, 7]]], [[2, 12], [[12, 2], [11, 5]]]]]], [[[[[[12, 1], [0, 12]], [[4, 11], [11, 4]]], [[[6, 10], [10, 6]], [11, 3]]], [[[[5, 10], [10, 5]], [2, 11]], [[11, 2], [1, 11]]]], [[[[11, 1], [[0, 11], [11, 0]]], [[[6, 9], [9, 6]], [[4, 10], [10, 4]]]], [[[[7, 8], [8, 7]], [10, 3]], [[[3, 10], [5, 9]], [2, 10]]]]]]]], [[[[[[[[[9, 5], [6, 8]], [10, 1]], [[[8, 6], [7, 7]], [9, 4]]], [[[[4, 9], [5, 7]], [6, 7]], [10, 2]]], [[[1, 10], [[0, 10], [10, 0]]], [[[3, 9], [9, 3]], [[5, 8], [8, 5]]]]], [[[[2, 9], [9, 2]], [[[7, 6], [0, 9]], [1, 9]]], [[[9, 1], [[9, 0], [4, 8]]], [[[8, 4], [7, 5]], [[3, 8], [8, 3]]]]]], [[[[[[6, 6], [2, 8]], [8, 2]], [[[4, 7], [7, 4]], [1, 8]]], [[[8, 1], [8, 0]], [[[0, 8], [5, 6]], [3, 7]]]], [[[[7, 3], [[6, 5], [4, 6]]], [[2, 7], [7, 2]]], [[[[6, 4], [5, 5]], [0, 7]], [1, 7]]]]], [[[[[7, 1], [[7, 0], [3, 6]]], [[[6, 3], [4, 5]], [[5, 4], [2, 6]]]], [[[6, 2], [1, 6]], [[6, 1], [[0, 6], [6, 0]]]]], [[[[5, 3], [[3, 5], [4, 4]]], [[2, 5], [5, 2]]], [[5, 1], [[1, 5], [0, 5]]]]]]], [[[[[[[3, 4], [4, 3]], [[5, 0], [2, 4]]], [[[4, 2], [3, 3]], [1, 4]]], [[[4, 1], [[0, 4], [4, 0]]], [[2, 3], [3, 2]]]], [[[1, 3], [3, 1]], [[[0, 3], [3, 0]], [2, 2]]]], [[[1, 2], [2, 1]], [[0, 2], [2, 0]]]]], [[[1, 1], [0, 1]], [1, 0]]], [0, 0]];
const bigvalueHufftab24: readonly any[] = [[[[[[[[[14, 15], [15, 14]], [[13, 15], [15, 13]]], [[[12, 15], [15, 12]], [[11, 15], [15, 11]]]], [[[15, 10], [[10, 15], [9, 15]]], [[15, 9], [15, 8]]]], [[[[[8, 15], [7, 15]], [15, 7]], [[6, 15], [15, 6]]], [[[5, 15], [15, 5]], [[4, 15], [15, 4]]]]], [[[[[3, 15], [15, 3]], [[2, 15], [15, 2]]], [[[15, 1], [[1, 15], [15, 0]]], [[[[0, 15], [[[14, 14], [13, 14]], [[14, 13], [12, 14]]]], [[[[14, 12], [13, 13]], [[11, 14], [14, 11]]], [[[12, 13], [13, 12]], [[10, 14], [14, 10]]]]], [[[[[11, 13], [13, 11]], [[12, 12], [9, 14]]], [[[14, 9], [10, 13]], [[13, 10], [11, 12]]]], [[[[12, 11], [8, 14]], [[14, 8], [9, 13]]], [[[13, 9], [7, 14]], [[14, 7], [10, 12]]]]]]]], [15, 15]]], [[[[[[[[[[12, 10], [11, 11]], [[8, 13], [13, 8]]], [[[[0, 14], [14, 0]], [0, 13]], [14, 6]]], [[[[6, 14], [9, 12]], [12, 9]], [[5, 14], [11, 10]]]], [[[[14, 5], [[10, 11], [7, 13]]], [[13, 7], [14, 4]]], [[[8, 12], [12, 8]], [[[4, 14], [2, 14]], [3, 14]]]]], [[[[[6, 13], [13, 6]], [[14, 3], [9, 11]]], [[[11, 9], [10, 10]], [[14, 2], [1, 14]]]], [[[[14, 1], [5, 13]], [[13, 5], [7, 12]]], [[[12, 7], [4, 13]], [[8, 11], [11, 8]]]]]], [[[[[[13, 4], [9, 10]], [[10, 9], [6, 12]]], [[[12, 6], [3, 13]], [[13, 3], [2, 13]]]], [[[[13, 2], [1, 13]], [[7, 11], [11, 7]]], [[[13, 1], [5, 12]], [[12, 5], [8, 10]]]]], [[[[[10, 8], [9, 9]], [[4, 12], [12, 4]]], [[[6, 11], [11, 6]], [[[13, 0], [0, 12]], [3, 12]]]], [[[[12, 3], [7, 10]], [[10, 7], [2, 12]]], [[[12, 2], [5, 11]], [[11, 5], [1, 12]]]]]]], [[[[[[[8, 9], [9, 8]], [[12, 1], [4, 11]]], [[[[12, 0], [0, 11]], [3, 11]], [[[11, 0], [0, 10]], [1, 10]]]], [[[11, 4], [[6, 10], [10, 6]]], [[[7, 9], [9, 7]], [[[10, 0], [0, 9]], [9, 0]]]]], [[[[11, 3], [8, 8]], [[[2, 11], [5, 10]], [11, 2]]], [[[[10, 5], [1, 11]], [[11, 1], [6, 9]]], [[9, 6], [10, 4]]]]], [[[[[[4, 10], [7, 8]], [8, 7]], [[3, 10], [10, 3]]], [[[5, 9], [9, 5]], [[2, 10], [10, 2]]]], [[[[10, 1], [6, 8]], [[8, 6], [7, 7]]], [[[4, 9], [9, 4]], [[3, 9], [9, 3]]]]]]], [[[[[[[5, 8], [8, 5]], [[2, 9], [6, 7]]], [[[7, 6], [9, 2]], [[1, 9], [9, 1]]]], [[[[4, 8], [8, 4]], [[5, 7], [7, 5]]], [[[3, 8], [8, 3]], [[6, 6], [2, 8]]]]], [[[[[8, 2], [1, 8]], [[4, 7], [7, 4]]], [[[8, 1], [[0, 8], [8, 0]]], [[5, 6], [6, 5]]]], [[[[1, 7], [[0, 7], [7, 0]]], [7, 3]], [[[3, 7], [2, 7]], [7, 2]]]]], [[[[[4, 6], [6, 4]], [[5, 5], [7, 1]]], [[[3, 6], [6, 3]], [[4, 5], [5, 4]]]], [[[[2, 6], [6, 2]], [[1, 6], [6, 1]]], [[[[0, 6], [6, 0]], [3, 5]], [[5, 3], [4, 4]]]]]]]], [[[[[[[[2, 5], [5, 2]], [[1, 5], [[0, 5], [5, 0]]]], [[5, 1], [[3, 4], [4, 3]]]], [[[2, 4], [4, 2]], [[3, 3], [1, 4]]]], [[[[4, 1], [[0, 4], [4, 0]]], [[2, 3], [3, 2]]], [[1, 3], [3, 1]]]], [[[[[0, 3], [3, 0]], [2, 2]], [1, 2]], [[2, 1], [[0, 2], [2, 0]]]]], [[[1, 1], [0, 1]], [[1, 0], [0, 0]]]]];

export const count1Hufftabs = [
    count1Hufftab0,
    count1Hufftab1,
];

// [tab, linbits]
export const bigvalueHufftabs: readonly (null | readonly [readonly any[], number])[] = [
    null,
    [bigvalueHufftab1, 0],
    [bigvalueHufftab2, 0],
    [bigvalueHufftab3, 0],
    null,
    [bigvalueHufftab5, 0],
    [bigvalueHufftab6, 0],
    [bigvalueHufftab7, 0],
    [bigvalueHufftab8, 0],
    [bigvalueHufftab9, 0],
    [bigvalueHufftab10, 0],
    [bigvalueHufftab11, 0],
    [bigvalueHufftab12, 0],
    [bigvalueHufftab13, 0],
    null,
    [bigvalueHufftab15, 0],
    [bigvalueHufftab16, 1],
    [bigvalueHufftab16, 2],
    [bigvalueHufftab16, 3],
    [bigvalueHufftab16, 4],
    [bigvalueHufftab16, 6],
    [bigvalueHufftab16, 8],
    [bigvalueHufftab16, 10],
    [bigvalueHufftab16, 13],
    [bigvalueHufftab24, 4],
    [bigvalueHufftab24, 5],
    [bigvalueHufftab24, 6],
    [bigvalueHufftab24, 7],
    [bigvalueHufftab24, 8],
    [bigvalueHufftab24, 9],
    [bigvalueHufftab24, 11],
    [bigvalueHufftab24, 13],
];

const scalefactor_band_indices = {
    44100: {
        long: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576],
        short: [0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192],
    },
    48000: {
        long: [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576],
        short: [0, 4, 8, 12, 16, 22, 28, 38, 50, 64, 80, 100, 126, 192],
    },
    32000: {
        long: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576],
        short: [0, 4, 8, 12, 16, 22, 30, 42, 58, 78, 104, 138, 180, 192],
    },
} as const;

// if this hits unexpected EOF, readbits throws.
async function readhuffsymbol(r: U8BitReader, tab: readonly any[]) {
    let cur = tab;
    for (; ;) {
        if (typeof cur[0] === "number") {
            return cur;
        }
        cur = cur[await r.readbits(1)];
    }
}

async function readlinsign(r: U8BitReader, linbits: number, rawx: number) {
    // ternary just for speed optimization
    const x = rawx + (linbits ? await r.readbits(linbits) : 0);
    if (x === 0) {
        // no sign bit transferred.
        return 0;
    }
    if (await r.readbits(1) !== 0) {
        return -x;
    } else {
        return x;
    }
}

async function readhuffbig(r: U8BitReader, tab: readonly any[], linbits: number) {
    const [rawx, rawy] = await readhuffsymbol(r, tab);
    const x = await readlinsign(r, linbits, rawx);
    const y = await readlinsign(r, linbits, rawy);
    return [x, y];
}

async function readhuffcount1(r: U8BitReader, tab: readonly any[]) {
    const [rawv, raww, rawx, rawy] = await readhuffsymbol(r, tab);
    const v = await readlinsign(r, 0, rawv);
    const w = await readlinsign(r, 0, raww);
    const x = await readlinsign(r, 0, rawx);
    const y = await readlinsign(r, 0, rawy);
    return [v, w, x, y];
}

// from Lagerstrom MP3 Thesis 2.4.3:
//     |------part3_length(huffman bits)------|       |
//     |---------big_value*2---------|        |       |
// [1] | region0 | region1 | region2 | count1 | rzero | [576]
async function readhuffman(r: U8BitReader, frame: PromiseType<ReturnType<typeof readframe>>, part3_length: number, gr: number, ch: number) {
    if (part3_length <= 0) {
        return Array(576).fill(0);
    }

    const part3_start = r.tell();

    // not "blocktype==2 and switch_point==true"? really block_split_flag?? its always true if blocktype==2!
    // IIS and Lagerstrom uses block_split_flag.
    // mp3decoder(haskell) completely ignores block_split_flag.
    const is_shortblock = (frame.sideinfo.block[gr][ch].block_type == 2 && frame.sideinfo.block[gr][ch].block_split_flag);
    const sampfreq = ([44100, 48000, 32000] as const)[frame.header.sampling_frequency];
    const region1start = is_shortblock ? 36 : scalefactor_band_indices[sampfreq].long[frame.sideinfo.block[gr][ch].region_address1 + 1];
    // note: mp3decoder(haskell) says "r1len = min ((bigvalues*2)-(min (bigvalues*2) 36)) 540" about 576. that is len, this is start.
    const region2start = is_shortblock ? 576 : scalefactor_band_indices[sampfreq].long[frame.sideinfo.block[gr][ch].region_address1 + frame.sideinfo.block[gr][ch].region_address2 + 2];

    const regionlens = [
        region1start,
        region2start - region1start,
        frame.sideinfo.big_values[gr][ch] * 2 - region2start,
    ];

    if (regionlens[2] < 0) {
        throw new Error(`negative region2len: ${regionlens[2]}`);
    }
    if (frame.sideinfo.block[gr][ch].block_split_flag && 0 < regionlens[2]) {
        throw new Error(`block_split but region2: ${regionlens[2]}`);
    }

    const is = []; // what is "is"? abbreviated? many I-s? what I?
    for (const region in regionlens) {
        const hufftab = bigvalueHufftabs[frame.sideinfo.block[gr][ch].table_select[region]];
        if (!hufftab) {
            throw new Error(`region${region} references bad table: ${frame.sideinfo.block[gr][ch].table_select[region]}`);
        }
        for (const _ of times(regionlens[region])) {
            is.push(...await readhuffbig(r, hufftab[0], hufftab[1]));
        }
    }

    const bigpartlen = r.tell() - part3_start;
    if (part3_length < bigpartlen) {
        throw new Error(`big_value exceeds part3_length: ${part3_length} < ${bigpartlen}`);
    }

    const hufftab = count1Hufftabs[frame.sideinfo.count1table_select[gr][ch]];
    while (r.tell() - part3_start < part3_length) {
        is.push(...await readhuffcount1(r, hufftab));
    }

    const part3read = r.tell() - part3_start;
    if (part3_length < part3read) {
        throw new Error(`const1 exceeds part3_length: ${part3_length} < ${part3read}`);
    }
    if (576 < is.length) {
        throw new Error(`is exceeds 576: ${is.length}`);
    }

    is.push(...Array(576 - is.length).fill(0));

    return is;
}

// ISO 11172-3 2.4.2.7 scalefac_compress
const scalefac_compress_tab = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3], [4, 2], [4, 3]];

async function decodeframe(prevframes: PromiseType<ReturnType<typeof readframe>>[], frame: PromiseType<ReturnType<typeof readframe>>) {
    const main_data = get_main_data(prevframes, frame);
    if (!main_data) {
        // not enough reservoir (started in middle of stream?), can't decode
        return null;
    }

    // if we readed frame.data this can be non-async.
    const r = new U8BitReader(main_data);
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;
    const scalefac: ({ type: "switch", scalefac_l: number[], scalefac_s_w: number[][]; } | { type: "short", scalefac_s: number[]; } | { type: "long", scalefac_l: number[]; })[][] = [];
    const is = [];
    for (const gr of times(2)) {
        const scalefac_gr = [];
        const is_gr = [];
        for (const ch of times(nchans)) {
            const block_gr_ch = frame.sideinfo.block[gr][ch];
            const scalefac_compress_gr_ch = frame.sideinfo.scalefac_compress[gr][ch];

            const part2_start = r.tell();

            // scale-factors are "part 2"
            const [slen1, slen2] = scalefac_compress_tab[scalefac_compress_gr_ch];
            if (block_gr_ch.block_type === 2) {
                // short-window
                if (block_gr_ch.switch_point) {
                    // long-and-short
                    const scalefac_l = [];
                    for (const band of range(0, 7 + 1)) {
                        scalefac_l[band] = await r.readbits(slen1);
                    }
                    const scalefac_s_w = [];
                    for (const [sfrbeg, sfrend, slen] of [[3, 5, slen1], [6, 11, slen2]]) { // 3..5, 6..11 from Lagerstrom MP3 Thesis and ISO 11172-3 2.4.2.7 switch_point[gr] switch_point_s
                        for (const band of range(sfrbeg, sfrend + 1)) {
                            const scalefac_s_w_band = [];
                            for (const window of times(3)) {
                                scalefac_s_w_band[window] = await r.readbits(slen);
                            }
                            scalefac_s_w[band] = scalefac_s_w_band;
                        }
                    }
                    scalefac_gr.push({
                        type: "switch",
                        scalefac_l,
                        scalefac_s_w,
                    } as const);
                } else {
                    // short
                    const scalefac_s = [];
                    for (const [sfrbeg, sfrend, slen] of [[0, 5, slen1], [6, 11, slen2]]) {
                        for (const band of range(sfrbeg, sfrend + 1)) {
                            scalefac_s[band] = await r.readbits(slen);
                        }
                    }
                    scalefac_gr.push({
                        type: "short",
                        scalefac_s,
                    } as const);
                }
            } else {
                // long-window
                // slen1 for 0..10, slen2 for 11..20
                // ISO 11172-3 2.4.2.7 scfsi_band: 0..5, 6..10, 11..15, 16..20
                const scalefac_l: number[] = [];
                await [[0, 5, slen1], [6, 10, slen1], [11, 15, slen2], [16, 20, slen2]].reduce(async (prev, [sfrbeg, sfrend, slen], group) => {
                    await prev;
                    for (const band of range(sfrbeg, sfrend + 1)) {
                        if (gr === 0 || !frame.sideinfo.scfsi[ch][group]) {
                            scalefac_l[band] = await r.readbits(slen);
                        } else {
                            // copy from granule 0 if gr===1 && scfsi===1
                            if (block_gr_ch.block_type === 2) {
                                throw new Error("scfsi=1 is not allowed if block_type===2 (short window)");
                            }
                            const scalefac_gr0 = scalefac[0][ch];
                            // const scalefac_l_gr0 = (scalefac_gr0 as { scalefac_l: number[]; }).scalefac_l;
                            if (scalefac_gr0.type !== "long") {
                                throw new Error(`BadImpl: window mutated between granule: ${scalefac_gr0}`);
                            }
                            const scalefac_l_gr0 = scalefac_gr0.scalefac_l;
                            scalefac_l[band] = scalefac_l_gr0[band];
                        }
                    }
                }, Promise.resolve());
                scalefac_gr.push({
                    type: "long",
                    scalefac_l,
                } as const);
            }

            const part2_length = r.tell() - part2_start;

            // read huffman "part 3"
            const part3_length = frame.sideinfo.part2_3_length[gr][ch] - part2_length;
            is_gr.push(await readhuffman(r, frame, part3_length, gr, ch));
        }
        scalefac.push(scalefac_gr);
        is.push(is_gr);
    }

    const ancillary_nbits = (8 - r.tell() % 8) % 8;
    const ancillary_bits = await r.readbits(ancillary_nbits);
    const ancillary_bytes = await r.readbytes((r.length - r.tell()) / 8);

    return {
        main_data,

        scalefac,
        is,

        ancillary_nbits,
        ancillary_bits,
        ancillary_bytes, // some of this are next or next-next frame's main_data.
    };
}

export async function parsefile(ab: ArrayBuffer) {
    const br = new U8BitReader(new Uint8Array(ab));
    const frames = [];
    const maindatas = [];
    while (!br.eof()) {
        const pos = br.tell();
        try {
            frames.push(await readframe(br));
            const framedata = await decodeframe(frames.slice(-3, -1), frames[frames.length - 1]); // recent 3 frames including current.
            if (framedata) {
                maindatas.push(framedata);
            }
        } catch {
            // try next byte, synchronizing to byte
            br.seek(Math.floor(pos / 8 + 1) * 8);
        }
    }
    console.log(frames);
    console.log(maindatas);
};

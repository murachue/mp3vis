import { times, range } from "lodash-es";

// https://log.pocka.io/posts/typescript-promisetype/
export type PromiseType<T extends Promise<any>> = T extends Promise<infer P>
    ? P
    : never;

// bslbf/uimsbf reader
function extb(bits: number, msboff: number, nbits: number) {
    return (bits >> (8 - nbits - msboff)) & ((1 << nbits) - 1);
}
class U8BitReader {
    u8: Uint8Array;
    atebits: number;
    bits: number | null;
    bypos: number;

    constructor(u8: Uint8Array) {
        this.u8 = u8;
        this.bypos = 0;
        this.atebits = 0;
        this.bits = null;
    }
    async readbits(nbits: number) {
        let b = 0;
        while (0 < nbits) {
            if (this.bits === null || 8 <= this.atebits) {
                if (this.eof()) {
                    // even if partial read succeeds.
                    throw new Error("!eof");
                }
                if (8 <= this.atebits) {
                    this.bypos += 1;
                    this.atebits = 0;
                }
                this.bits = this.u8[this.bypos];
            }
            const r = Math.min(8 - this.atebits, nbits); // read n bits in this byte
            b = (b << r) | extb(this.bits, this.atebits, r);
            this.atebits += r;
            nbits -= r;
        }
        return b;
    }
    async readbytes(nbytes: number) {
        this.byteboundary();
        const offb = this.nextbyte();
        const nrb = Math.min(this.u8.length - offb, nbytes);
        const bys = this.u8.slice(offb, offb + nrb);
        this.bypos += nrb;
        if (nrb < nbytes) {
            // even if partial read succeeds.
            throw new Error("!eof");
        }
        return bys;
    }
    async findbyte(byte: number) {
        this.byteboundary();
        const i = this.u8.indexOf(byte, this.nextbyte());
        if (i === -1) {
            return false;
        }
        this.seek(i * 8);
        return true;
    }
    byteboundary() {
        if (this.atebits % 8 !== 0) {
            throw new Error(`not byte boundary tell=${this.tell()}`);
        }
    }
    nextbyte() {
        return this.bypos + this.atebits / 8;
    }
    seek(bipos: number) {
        bipos = Math.min(bipos, this.u8.length * 8);
        this.bypos = Math.floor(bipos / 8);
        this.atebits = bipos % 8;
        this.bits = null;
    }
    tell() {
        return this.bypos * 8 + this.atebits;
    }
    eof() {
        return this.u8.length <= this.nextbyte();
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
    if (layer !== 1) {
        throw new Error("!non-layer3 not supported yet");
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
}
export type Header = PromiseType<ReturnType<typeof readheader>>;

async function readlayer3sideinfo(r: U8BitReader, header: PromiseType<ReturnType<typeof readheader>>) {
    const is_mono = header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const main_data_end = await r.readbits(9); // means this frame needs this more bytes from previous last
    const private_bits = await r.readbits(is_mono ? 5 : 3); // thanks to this private_bits (padding), end of side_infos are on byte boundary.
    // note: scfsi just for long windows.
    const scfsi = [];
    for (const ch of times(nchans)) { // eslint-disable-line @typescript-eslint/no-unused-vars
        const scfsi_ch = [];
        // for bands 0..5, 6..10, 11..15, 16..20 (note: only first is 6 elms not 5!)
        for (const band of times(4)) { // eslint-disable-line @typescript-eslint/no-unused-vars
            scfsi_ch.push(await r.readbits(1));
        }
        scfsi.push(scfsi_ch);
    }

    const granule_tmp = [];
    for (const gr of times(2)) { // eslint-disable-line @typescript-eslint/no-unused-vars
        const channel = [];
        for (const ch of times(nchans)) { // eslint-disable-line @typescript-eslint/no-unused-vars
            const part2_3_length = await r.readbits(12);
            const big_values = await r.readbits(9);
            const global_gain = await r.readbits(8);
            const scalefac_compress = await r.readbits(4);
            const blocksplit_flag = await r.readbits(1);
            const blockpart = await (async () => {
                // both are 22bits
                if (blocksplit_flag) {
                    // non-normal window
                    const block_type = await r.readbits(2);
                    const switch_point = await r.readbits(1);
                    const table_select = [];
                    for (const region of times(2)) { // eslint-disable-line @typescript-eslint/no-unused-vars
                        table_select.push(await r.readbits(5));
                    }
                    const subblock_gain = [];
                    for (const window of times(3)) { // eslint-disable-line @typescript-eslint/no-unused-vars
                        subblock_gain.push(await r.readbits(3));
                    }

                    if (block_type === 0) {
                        throw new Error("!reserved:inconsistency-normal-window blocksplit_flag=1 but block_type=0");
                    }

                    if (switch_point === 1 && block_type !== 2) {
                        // it seems...
                        throw new Error(`!ReadTheF*ckingSpec: switch_point become 1 only if block_type is 2 but ${block_type}`);
                    }

                    // they from Lagerstrom MP3 Thesis
                    const region_address1 = (block_type === 2 && switch_point === 0) ? 8 : 7;
                    const region_address2 = 20 - region_address1; // means no region2 (region_address2 points to end of bands)

                    return {
                        blocksplit_flag: true, // window_switch(ing)?
                        block_type, // 0=reserved(normal) 1=start_block 2=3_short_windows 3=end_block
                        switch_point, // mixed_block?
                        table_select,
                        subblock_gain,
                        region_address1,
                        region_address2,
                    } as const;
                } else {
                    // normal window
                    const table_select = [];
                    for (const region of times(3)) { // eslint-disable-line @typescript-eslint/no-unused-vars
                        table_select.push(await r.readbits(5));
                    }
                    const region_address1 = await r.readbits(4);
                    const region_address2 = await r.readbits(3);

                    return {
                        blocksplit_flag: false, // window_switch?
                        block_type: 0,
                        switch_point: null, // mixed_block?
                        table_select,
                        subblock_gain: null,
                        region_address1,
                        region_address2,
                    } as const;
                }
            })();
            const preflag = await r.readbits(1);
            const scalefac_scale = await r.readbits(1);
            const count1table_select = await r.readbits(1);

            channel.push({
                part2_3_length, // in "bits"
                big_values,
                global_gain,
                scalefac_compress,
                // blocksplit_flag,
                ...blockpart,
                preflag,
                scalefac_scale,
                count1table_select,
            });
        }
        granule_tmp.push({
            channel,
        });
    }

    // swap gr and ch for beauty of data structure.
    const channel = [];
    for (const ch of times(nchans)) {
        const granule = [];
        for (const gr of times(2)) {
            granule.push(granule_tmp[gr].channel[ch]);
        }
        channel.push({
            scfsi: scfsi[ch], // SCaleFactor Selection Information
            granule,
        });
    }

    return {
        main_data_end, // in "bytes"
        private_bits,
        channel,
    };
}
export type Sideinfo = PromiseType<ReturnType<typeof readlayer3sideinfo>>;

export const sampling_frequencies = [44100, 48000, 32000] as const; // [3] is reserved.
// TODO: how to measure framebytes in free-format? try to read next sync and then read?? difficult on buffering...
function frame_bytes(header: PromiseType<ReturnType<typeof readheader>>) {
    const bitrate_kbps = layer3_bitrate_kbps[header.bitrate_index - 1];
    const sampfreq = sampling_frequencies[header.sampling_frequency];
    // from Lagerstrom MP3 Thesis. also in ISO 11172-3 2.4.3.1.
    return Math.floor(144 * bitrate_kbps * 1000 / sampfreq) + header.padding_bit;
}

export const layer3_bitrate_kbps = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
async function readframe(r: U8BitReader) {
    const offset = r.tell() / 8;
    const header = await readheader(r);
    const crc_check = (header.protection_bit === 0) ? await r.readbits(16) : null;
    if (header.layer !== 1) { // layer3
        throw new Error("!not-layer3");
    }
    const sideinfo = await readlayer3sideinfo(r, header);
    // note: it seems here becomes byte-boundary. spec carefully made? (using private_bits as padding)

    if (header.bitrate_index === 0) {
        throw new Error("free-format not supported yet");
    }
    const head_side_size = r.tell() / 8 - offset;

    const head_side_bytes = await (async () => {
        const end_of_header = r.tell();
        r.seek(offset * 8);
        const head_side_bytes = await r.readbytes(head_side_size);
        r.seek(end_of_header);
        return head_side_bytes;
    })();

    const framebytes = frame_bytes(header);
    const data = await r.readbytes(framebytes - head_side_size);
    const totalsize = r.tell() / 8 - offset;
    // TODO: crc_check
    return {
        offset,
        header,
        crc_check,
        sideinfo,
        head_side_size,
        head_side_bytes, // just for visualization
        data, // not main_data that is reassembled.
        totalsize,
    };
}
export type Frame = PromiseType<ReturnType<typeof readframe>>;

// https://stackoverflow.com/a/35633935
function concat<T extends Uint8Array>(a: T, b: T) {
    const x = new (a.constructor as any)(a.length + b.length);
    x.set(a);
    x.set(b, a.length);
    return x;
}

// note: this will return more than enough on tail.
function get_main_data(prevframes: Frame[], frame: Frame) {
    // ugly but can't flatMap to Uint8Array...
    const reservoir = prevframes.map(f => f.data).reduce((p, c) => concat(p, c), new Uint8Array());
    if (reservoir.length < frame.sideinfo.main_data_end) {
        // not enough reservoir (started in middle of stream?), can't decode
        return null;
    }

    // explicitly (non-negative) start also handles main_data_end===0.
    return concat(reservoir.slice(reservoir.length - frame.sideinfo.main_data_end), frame.data);
}

// note: they are actually "T=[T,T]|[number,number]" but such union-recursive type tortures typescript compiler...
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

const count1Hufftabs = [
    count1Hufftab0,
    count1Hufftab1,
];

const bigvalueHufftabs = [
    { table: null },
    { table: bigvalueHufftab1, linbits: 0 },
    { table: bigvalueHufftab2, linbits: 0 },
    { table: bigvalueHufftab3, linbits: 0 },
    { table: null },
    { table: bigvalueHufftab5, linbits: 0 },
    { table: bigvalueHufftab6, linbits: 0 },
    { table: bigvalueHufftab7, linbits: 0 },
    { table: bigvalueHufftab8, linbits: 0 },
    { table: bigvalueHufftab9, linbits: 0 },
    { table: bigvalueHufftab10, linbits: 0 },
    { table: bigvalueHufftab11, linbits: 0 },
    { table: bigvalueHufftab12, linbits: 0 },
    { table: bigvalueHufftab13, linbits: 0 },
    { table: null },
    { table: bigvalueHufftab15, linbits: 0 },
    { table: bigvalueHufftab16, linbits: 1 },
    { table: bigvalueHufftab16, linbits: 2 },
    { table: bigvalueHufftab16, linbits: 3 },
    { table: bigvalueHufftab16, linbits: 4 },
    { table: bigvalueHufftab16, linbits: 6 },
    { table: bigvalueHufftab16, linbits: 8 },
    { table: bigvalueHufftab16, linbits: 10 },
    { table: bigvalueHufftab16, linbits: 13 },
    { table: bigvalueHufftab24, linbits: 4 },
    { table: bigvalueHufftab24, linbits: 5 },
    { table: bigvalueHufftab24, linbits: 6 },
    { table: bigvalueHufftab24, linbits: 7 },
    { table: bigvalueHufftab24, linbits: 8 },
    { table: bigvalueHufftab24, linbits: 9 },
    { table: bigvalueHufftab24, linbits: 11 },
    { table: bigvalueHufftab24, linbits: 13 },
] as const;

// used for region_address to subbands, and requantize.
// tips: 36 = sf_band_long[8] = sf_band_short[3] * 3(windows) = 18(width/filterbank_band) * 2(num_band) is even point for block_split(type: "mixed").
// tips: they have extra 1 band than each scalefactors...
// 0..20+1+end subbands for long.
export const scalefactor_band_indices_long = {
    44100: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576],
    48000: [0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576],
    32000: [0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576],
} as const;
// 0..11+1+end subbands for short.
export const scalefactor_band_indices_short = {
    44100: [0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192],
    48000: [0, 4, 8, 12, 16, 22, 28, 38, 50, 64, 80, 100, 126, 192],
    32000: [0, 4, 8, 12, 16, 22, 30, 42, 58, 78, 104, 138, 180, 192],
} as const;

// if this hits unexpected EOF, readbits throws.
async function readhuffsymbol(r: U8BitReader, tab: readonly any[]) {
    let cur = tab;
    let bits = "";
    for (; ;) {
        if (typeof cur[0] === "number") {
            return { value: cur, bits };
        }
        const bit = await r.readbits(1);
        cur = cur[bit];
        bits += bit; // string-concat
    }
}

async function readlinbits(r: U8BitReader, linbits: number, rawx: number) {
    // linbits only when value is maximum.
    if (linbits === 0 || rawx < 15) {
        return { value: 0, linbits: "" };
    }
    const value = await r.readbits(linbits);
    return { value, linbits: value.toString(2).padStart(linbits, "0") };
}

async function readsign(r: U8BitReader, x: number) {
    const signbit = await r.readbits(1);
    if (signbit) {
        return { value: -x, sign: "1" };
    } else {
        return { value: x, sign: "0" };
    }
}

async function readlinsign(r: U8BitReader, nlinbits: number, rawx: number) {
    if (rawx === 0) {
        // no sign bit transferred.
        return { value: 0, linbits: "", sign: "" };
    }

    const linbits = await readlinbits(r, nlinbits, rawx);
    const x = rawx + linbits.value;
    const sign = await readsign(r, x);
    return { value: sign.value, linbits: linbits.linbits, sign: sign.sign };
}

async function readhuffbig(r: U8BitReader, tab: typeof bigvalueHufftabs[number]) {
    // note: null table is also valid...
    if (!tab.table) {
        return { value: [0, 0], huffbits: "", pairbits: [{ value: 0, linbits: "", sign: "" }, { value: 0, linbits: "", sign: "" }] };
    }

    const { value: [rawx, rawy], bits } = await readhuffsymbol(r, tab.table);
    const x = await readlinsign(r, tab.linbits, rawx);
    const y = await readlinsign(r, tab.linbits, rawy);
    return { value: [x.value, y.value], huffbits: bits, pairbits: [x, y] };
}

async function readhuffcount1(r: U8BitReader, tab: readonly any[]) {
    const { value: [rawv, raww, rawx, rawy], bits } = await readhuffsymbol(r, tab);
    const v = await readlinsign(r, 0, rawv);
    const w = await readlinsign(r, 0, raww);
    const x = await readlinsign(r, 0, rawx);
    const y = await readlinsign(r, 0, rawy);
    return { value: [v.value, w.value, x.value, y.value], huffbits: bits, tuplebits: [v, w, x, y] };
}

// from Lagerstrom MP3 Thesis 2.4.3:
//     |------part3_length(huffman bits)------|       |
//     |---------big_value*2---------|        |       |
// [1] | region0 | region1 | region2 | count1 | rzero | [576]
async function readhuffman(r: U8BitReader, frame: Frame, part3_length: number, gr: number, ch: number) {
    if (part3_length <= 0) {
        return {
            is: Array<number>(576).fill(0),
            zero_part_begin: 0,

            bigs: [],
            ones: [],
            ones_extra: [],
        };
    }

    const part3_start = r.tell();

    const sideinfo = frame.sideinfo.channel[ch].granule[gr];

    // not "blocktype==2 and switch_point==true"? really blocksplit_flag?? its always true if blocktype==2!
    // IIS and Lagerstrom uses blocksplit_flag.
    // mp3decoder(haskell) completely ignores blocksplit_flag.
    // but also region_start* are set (const) even when block_type==2??
    const is_shortblock = (sideinfo.block_type === 2 && sideinfo.blocksplit_flag);
    const sampfreq = sampling_frequencies[frame.header.sampling_frequency];
    const bigvalues = sideinfo.big_values * 2;
    // added by one? but ISO 11172-3 2.4.2.7 region_address1 says 0 is 0 "no first region"...?
    // note: all long[8] is 36.
    const rawregion1start = scalefactor_band_indices_long[sampfreq][is_shortblock ? 8 : (sideinfo.region_address1 + 1)];
    const region1start = Math.min(bigvalues, rawregion1start); // region1start also may overruns
    // note: rawregion2start naturally overruns to indicate "no region2"
    // note: mp3decoder(haskell) says "r1len = min ((bigvalues*2)-(min (bigvalues*2) 36)) 540" about 576. that is len, this is start.
    // note: all long[22] is 576.
    const rawregion2start = scalefactor_band_indices_long[sampfreq][is_shortblock ? 22 : (sideinfo.region_address1 + sideinfo.region_address2 + 2)];
    const region2start = Math.min(bigvalues, rawregion2start);

    const regionlens = [
        region1start,
        region2start - region1start,
        bigvalues - region2start,
    ];

    if (bigvalues < region2start && rawregion2start !== 576) {
        throw new Error(`abnormal negative region2len: bigvalues=${bigvalues} < region2start=${region2start}`);
    }
    if (sideinfo.blocksplit_flag && 0 < regionlens[2]) {
        throw new Error(`block_split but region2: ${regionlens[2]}`);
    }

    const bigs = [];
    for (const region in regionlens) {
        const regionlen = regionlens[region];
        if (regionlen === 0) {
            // blocksplit_flag=true then table_select[2] is undefined!
            continue;
        }
        const tabsel = sideinfo.table_select[region];
        const hufftab = bigvalueHufftabs[tabsel];
        // null table is valid but usually 0. throw if tabsel !== 0 to detect non-usual...
        if (!hufftab.table && tabsel !== 0) {
            throw new Error(`region${region} references bad table: ${tabsel}`);
        }
        // they are raw "is" count... here reads by 2.
        for (const pair_i of times(regionlen / 2)) {  // eslint-disable-line @typescript-eslint/no-unused-vars
            bigs.push(await readhuffbig(r, hufftab));
        }
    }

    const bigpartread = r.tell() - part3_start;
    if (part3_length < bigpartread) {
        throw new Error(`big_value exceeds part3_length: ${part3_length} < ${bigpartread}`);
    }
    if (bigpartread < part3_length && 576 / 2 <= bigs.length) {
        throw new Error("is already filled but garbage bits");
    }

    const hufftab = count1Hufftabs[sideinfo.count1table_select];
    const ones = [];
    while (r.tell() - part3_start < part3_length) {
        ones.push(await readhuffcount1(r, hufftab));
    }

    // it may overruns... ex. GOGO no coder.
    const part3read = r.tell() - part3_start;
    const ones_extra = [];
    if (part3_length < part3read) {
        // throw new Error(`const1 exceeds part3_length: ${part3_length} < ${part3read}`);
        // we must treat this case; as we did not read last quads.
        ones_extra.push(ones.pop()!);
    }
    const is = bigs.flatMap(e => e.value).concat(ones.flatMap(e => e.value)); // what is "is"? abbreviated? many I-s? what I?
    if (576 < is.length) {
        // throw new Error(`is exceeds 576: ${is.length}`);
        // some encoder emit data like this...
        // reference decoder will break immediately on is.length===576.
        // in this decoder, read till end, but caller rewinds to part2_3_length.
        // so only truncating "is" to 576 is enough.
        is.splice(576, is.length - 576);
    }

    const zero_part_begin = is.length;

    is.push(...Array(576 - is.length).fill(0));

    return {
        is,
        zero_part_begin,

        bigs,
        ones,
        ones_extra,
    };
}

// ISO 11172-3 2.4.2.7 scalefac_compress
export const scalefac_compress_tab = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3], [4, 2], [4, 3]];

async function readscalefac(r: U8BitReader, sideinfo: SideinfoOfOneBlock, granule: number, scfsi: Sideinfo["channel"][number]["scfsi"]) {
    const [slen1, slen2] = scalefac_compress_tab[sideinfo.scalefac_compress];

    if (sideinfo.block_type !== 2) {
        // long-window
        // slen1 for 0..10, slen2 for 11..20
        // ISO 11172-3 2.4.2.7 scfsi_band: 0..5, 6..10, 11..15, 16..20
        // const scalefac_l: number[] = [];
        const band_groups = [[0, 5, slen1, scfsi[0]], [6, 10, slen1, scfsi[1]], [11, 15, slen2, scfsi[2]], [16, 20, slen2, scfsi[3]]];
        // note: we want flatMap but order of reading bits is strictly important. we must use reduce to ensure it.
        const scalefac_l = [];
        for (const [sfrbeg, sfrend, slen, scfsi] of band_groups) {
            for (const band of range(sfrbeg, sfrend + 1)) {  // eslint-disable-line @typescript-eslint/no-unused-vars
                if (granule === 0 || !scfsi) {
                    const sf = await r.readbits(slen);
                    scalefac_l.push(sf); // scalefac_l[band] = sf;
                } else {
                    // should copy from granule 0 if gr===1 && scfsi===1
                    if (sideinfo.block_type === 2) {
                        throw new Error("scfsi=1 is not allowed if block_type===2 (short window)");
                    }
                    // fill it later; use NaN to make more disaster when failed (not "broken-a-bit") to easy bug detection, but satisfy number type.
                    scalefac_l.push(0 / 0); // scalefac_l[band] = 0/0;
                }
            }
        }
        return {
            type: "long",
            scalefac_l,
        } as const;
    }

    // short-window
    if (sideinfo.switch_point) {
        // long-and-short
        // even point (in samples) is 36. it is long[8] and short[3] * 3 in bands.
        // long does not include 36, short does.
        const scalefac_l = [];
        for (const band of range(0, 7 + 1)) {
            scalefac_l[band] = await r.readbits(slen1);
        }
        const scalefac_s = [];
        // 3..5, 6..11 from Lagerstrom MP3 Thesis and ISO 11172-3 2.4.2.7 switch_point[gr] switch_point_s,
        // but not from ISO 11172-3 2.4.2.7 scalefac_compress[gr] (it says 4..5, 6..11).
        for (const [sfrbeg, sfrend, slen] of [[3, 5, slen1], [6, 11, slen2]]) {
            for (const band of range(sfrbeg, sfrend + 1)) {
                const scalefac_s_w_band = [];
                for (const window of times(3)) {  // eslint-disable-line @typescript-eslint/no-unused-vars
                    scalefac_s_w_band.push(await r.readbits(slen));
                }
                scalefac_s[band] = scalefac_s_w_band;
            }
        }
        return {
            type: "mixed",
            scalefac_l,
            scalefac_s,
        } as const;
    } else {
        // short
        const scalefac_s = [];
        for (const [sfrbeg, sfrend, slen] of [[0, 5, slen1], [6, 11, slen2]]) {
            for (const band of range(sfrbeg, sfrend + 1)) {
                // !!! spec is wrong. short-window also have 3 windows. Lagerstrom MP3 Thesis did not touch this!
                const scalefac_s_w_band = [];
                for (const window of times(3)) {  // eslint-disable-line @typescript-eslint/no-unused-vars
                    scalefac_s_w_band.push(await r.readbits(slen));
                }
                scalefac_s[band] = scalefac_s_w_band;
            }
        }
        return {
            type: "short",
            scalefac_s,
        } as const;
    }
}

// note: scalefac_gr0_ch is null if gr===0, non-null otherwise.
function selectscalefac(scalefac: PromiseType<ReturnType<typeof readscalefac>>, sideinfo_ch: Sideinfo["channel"][number], scalefac_gr0_ch: PromiseType<ReturnType<typeof readscalefac>> | null) {
    // no need to copy if gr===0 (this is source)
    if (!scalefac_gr0_ch) {
        return scalefac;
    }
    // other than long-window does not support scfsi
    if (scalefac.type !== "long") {
        return scalefac;
    }

    // copy scalefac if scfsi
    const [slen1, slen2] = scalefac_compress_tab[sideinfo_ch.granule[1].scalefac_compress];
    const scfsi = sideinfo_ch.scfsi;
    const band_groups = [[0, 5, slen1, scfsi[0]], [6, 10, slen1, scfsi[1]], [11, 15, slen2, scfsi[2]], [16, 20, slen2, scfsi[3]]];
    const scalefac_l = [...scalefac.scalefac_l];
    for (const [sfrbeg, sfrend, _slen, scfsi] of band_groups) {  // eslint-disable-line @typescript-eslint/no-unused-vars
        if (!scfsi) {
            continue;
        }
        if (scalefac_gr0_ch.type !== "long") {
            throw new Error(`scfsi but gr0 not long: ${scalefac_gr0_ch.type}`);
        }
        for (const band of range(sfrbeg, sfrend + 1)) {
            scalefac_l[band] = scalefac_gr0_ch.scalefac_l![band];
        }
    }

    return { ...scalefac, scalefac_l };
}

async function unpackframe(prevframes: Frame[], frame: Frame) {
    const main_data = get_main_data(prevframes, frame);
    if (!main_data) {
        // not enough reservoir (started in middle of stream?), can't decode
        return null;
    }

    // if we readed frame.data this can be non-async.
    const r = new U8BitReader(main_data);
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;
    const granule/* : {
        channel: {
            scalefac: { type: "switch", scalefac_l: number[], scalefac_s: number[][]; } | { type: "short", scalefac_s: number[][]; } | { type: "long", scalefac_l: number[]; };
            is: number[];
        }[];
    }[] */ = [];
    for (const gr of times(2)) {
        const channel = [];
        for (const ch of times(nchans)) {
            const sideinfo = frame.sideinfo.channel[ch].granule[gr];

            const part2_start = r.tell();

            const scfsi_ch = frame.sideinfo.channel[ch].scfsi;
            const raw_scalefac_gr_ch = await readscalefac(r, sideinfo, gr, scfsi_ch);
            // scale-factors are "part 2"
            const scalefac_gr_ch = selectscalefac(raw_scalefac_gr_ch, frame.sideinfo.channel[ch], gr === 0 ? null : granule[0].channel[ch].scalefac);

            const part2_length = r.tell() - part2_start;

            // read huffman "part 3"
            const part3_length = sideinfo.part2_3_length - part2_length;
            const is_gr_ch = await readhuffman(r, frame, part3_length, gr, ch);

            // we must seek, to recovery from "read exceeds count1-boundary" case.
            r.seek(part2_start + sideinfo.part2_3_length);

            channel.push({
                part2_length,
                part3_length,
                raw_scalefac: raw_scalefac_gr_ch,
                scalefac: scalefac_gr_ch,
                is: is_gr_ch,
            });
        }
        granule.push({ channel });
    }

    const ancillary_nbits = (8 - r.tell() % 8) % 8;
    const ancillary_bits = await r.readbits(ancillary_nbits);
    const ancillary_bytes = await r.readbytes((r.length - r.tell()) / 8);

    return {
        main_data,

        granule,

        ancillary_nbits,
        ancillary_bits,
        ancillary_bytes, // some of this are next or next-next frame's main_data.
    };
}
export type Maindata = NonNullable<PromiseType<ReturnType<typeof unpackframe>>>;

const array_cons_diff = (arr: readonly number[]) => {
    const diff = arr.map((e, i) => arr[i + 1] - e);
    diff.pop(); // last is invalid (NaN)
    return diff;
};
const object_values_map = <K extends string | number, V, VA>(obj: Record<K, V>, fn: (value: V) => VA): Record<K, VA> => {
    return Object.assign({}, ...Object.entries(obj as { [k: string]: V; }).map(([k, v]) => ({ [k]: fn(v) })));
};
const subbands_long_lengths = object_values_map(scalefactor_band_indices_long, array_cons_diff);
const subbands_short_lengths = object_values_map(scalefactor_band_indices_short, array_cons_diff);

// power with negative support.
export function powReal(value: number, power: number) {
    return Math.pow(Math.abs(value), power) * (value < 0 ? -1 : 1);
}
export function requantizeMultiplier(scale_step: 0.5 | 1, scalefac: number, global_gain: number, subblock_gain: number) {
    // scaledown to 0...1.0, int2frac.
    // pre: only with long-block.
    // expression is simplified:
    //   2 ^ ...
    //       .25 * (- 2 * (1 + scalestep) * scalefac - 2 * (1 + scale_step) * pre)
    //     = .5 * (- (1 + scalestep) * scalefac - (1 + scale_step) * pre)
    //     = .5 * (- (1 + scalestep) * (scalefac + pre))
    //     -- scalestep is 0 or 1.
    //     = .5 * (- {1 or 2} * (scalefac + pre))
    //     = - {0.5 or 1} * (scalefac + pre)
    //     -- assume pre is added to scalefac.
    //     = - {0.5 or 1} * scalefac
    const normalizer = Math.pow(2, -scale_step * scalefac);
    // apply gain.
    // 210 is magic. !!in spec it is 64
    // subblock_gain: only with short-block (incl. mixed).
    const gainer = Math.pow(2, 0.25 * (global_gain - 210 - 8 * subblock_gain));
    return normalizer * gainer;
}
// just (corrected) naive implementation of ISO 11172-3 2.4.3.4 "Formula for requantization and all scaling"...
export function requantizeSample(rawsample: number, scale_step: 0.5 | 1, scalefac: number, global_gain: number, subblock_gain: number) {
    // mysterious is[i]^(4/3) scaling.
    const prescaled = powReal(rawsample, 4 / 3);
    // then multiply frac(normalizer) and gain
    return prescaled * requantizeMultiplier(scale_step, scalefac, global_gain, subblock_gain);
}

export type SideinfoOfOneBlock = Frame["sideinfo"]["channel"][number]["granule"][number];
export type MaindataOfOneBlock = Maindata["granule"][number]["channel"][number];

// XXX: arguments are too complicated
function requantizeLongTill(sampfreq: typeof sampling_frequencies[number], scale_step: 1 | 0.5, global_gain: number, scalefac_l: number[], is: number[], till: number) {
    // padding 0 for scalefac_l.length==21 but subbands_long_lengths.length==22
    // XXX: is it ensured that zero_part_begin does not exceeds long_band[21]==418/384/550??
    const scalefac = scalefac_l.concat([0]).slice(0, till);
    // process for easily zipped with "is"
    const scalefac_i = subbands_long_lengths[sampfreq].slice(0, till).flatMap((len, i) => Array(len).fill(scalefac[i])) as number[];

    // XXX: we should only do 0...zero_part_begin for speed optimization.
    return is.slice(0, scalefactor_band_indices_long[sampfreq][till]).map((rawsample, i) => {
        return requantizeSample(rawsample, scale_step, scalefac_i[i], global_gain, 0);
    });
}
// XXX: arguments are too complicated
function requantizeShortFrom(sampfreq: typeof sampling_frequencies[number], scale_step: 1 | 0.5, global_gain: number, subblock_gain: number[], scalefac_s: number[][], is: number[], from: number) {
    const band_len = subbands_short_lengths[sampfreq];
    // padding 0 for scalefac_s.length==12 but subbands_short_lengths.length==13
    // XXX: is it ensured that zero_part_begin does not exceeds short_band[12]==418/384/550??
    const scalefac = scalefac_s.concat([[0, 0, 0]]);

    // XXX: we should only do 0...zero_part_begin for speed optimization.
    const requantized = [];
    let i = scalefactor_band_indices_short[sampfreq][from] * 3;
    for (const band of range(from, 13)) {
        for (const win of times(3)) {
            for (const band_i of times(band_len[band])) {  // eslint-disable-line @typescript-eslint/no-unused-vars
                const rawsample = is[i];
                const rs = requantizeSample(rawsample, scale_step, scalefac[band][win], global_gain, subblock_gain[win]);
                i++;
                requantized.push(rs);
            }
        }
    }
    return requantized;
}
// pretab: "shortcut" to scalefactor. this can be used to make finally encoded scalefac smaller on higher freq band.
// only for long blocks, in subbands.
// note: concat'ing [0] for last beyond scalefacs (truly last scalefactor_band that is not encoded).
const pretab = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 3, 2].concat([0]);
function scalefacWithPretab(preflag: number, scalefac_l: number[]) {
    return scalefac_l.map((sf, i) => sf + (preflag ? pretab[i] : 0));
}
function requantizeOne(frame: Frame, sideinfo_gr_ch: SideinfoOfOneBlock, maindata_gr_ch: MaindataOfOneBlock) {
    const scale_step = sideinfo_gr_ch.scalefac_scale ? 1 : 0.5; // 0=sqrt2 1=2
    const sampfreq = sampling_frequencies[frame.header.sampling_frequency];
    const is = maindata_gr_ch.is.is;

    switch (maindata_gr_ch.scalefac.type) {
        case "long": { // sideinfo.block_type !== 2
            const scalefac_l_final = scalefacWithPretab(sideinfo_gr_ch.preflag, maindata_gr_ch.scalefac.scalefac_l);
            return {
                samples: requantizeLongTill(sampfreq, scale_step, sideinfo_gr_ch.global_gain, scalefac_l_final, is, 22),
                scalefac_l: scalefac_l_final,
            };
        }
        case "short": // sideinfo.switch_point === 0
            // sideinfo_gr_ch.subblock_gain!: if block_type==2 then blocksplit_flag==1 and there is subblock_gain.
            return {
                samples: requantizeShortFrom(sampfreq, scale_step, sideinfo_gr_ch.global_gain, sideinfo_gr_ch.subblock_gain!, maindata_gr_ch.scalefac.scalefac_s, is, 0),
                scalefac_s: maindata_gr_ch.scalefac.scalefac_s,
            };
        case "mixed": { // else (block_type === 2 && switch_point === 1)
            // till even point 36 = long_scalefactor_indices[8], requantize as long. no pretab for mixed (anyway they are 0 till [8]).
            const long_requantized = requantizeLongTill(sampfreq, scale_step, sideinfo_gr_ch.global_gain, maindata_gr_ch.scalefac.scalefac_l, is, 8);
            // from even point 36 = short_scalefactor_indices[3], requantize as short.
            // sideinfo_gr_ch.subblock_gain!: if block_type==2 then blocksplit_flag==1 and there is subblock_gain.
            const short_requantized = requantizeShortFrom(sampfreq, scale_step, sideinfo_gr_ch.global_gain, sideinfo_gr_ch.subblock_gain!, maindata_gr_ch.scalefac.scalefac_s, is, 3);
            return {
                samples: long_requantized.concat(short_requantized),
                scalefac_l: maindata_gr_ch.scalefac.scalefac_l,
                scalefac_s: maindata_gr_ch.scalefac.scalefac_s,
            };
        }
        // default:
        //     throw new Error(`bad type: ${maindata_gr_ch.scalefac.type}`);
    }
}

function requantize(frame: Frame, maindata: Maindata) {
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const granule = [];
    for (const gr of times(2)) {
        const channel = [];
        for (const ch of times(nchans)) {
            const sideinfo_gr_ch = frame.sideinfo.channel[ch].granule[gr];
            const maindata_gr_ch = maindata.granule[gr].channel[ch];
            channel.push(requantizeOne(frame, sideinfo_gr_ch, maindata_gr_ch));
        }

        granule.push({ channel });
    }

    return {
        granule,
    };
}
export type Requantized = ReturnType<typeof requantize>;

// TODO: reorder short blocks just for make intensity-stereo processing easy???
//       but intensity-stereo processing seems also wrong...?????
function reorder(frame: Frame, requantized: ReturnType<typeof requantize>) {
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const granule = [];
    for (const gr of times(2)) {
        const channel = [];
        for (const ch of times(nchans)) {
            const requantized_gr_ch = requantized.granule[gr].channel[ch];

            if (frame.sideinfo.channel[ch].granule[gr].block_type !== 2) {
                // long window is not reordered.
                channel.push({ samples: requantized_gr_ch.samples });
                continue;
            }

            // here, short or long-short(mixed) block.

            // time-order(freq-interleaved) to freq-order(time-interleaved).
            //   a[0...3], b[0...3], c[0...3], a[4...], ... (a[4] is next band's)
            //   => a[0], b[0], c[0], a[1], b[1], c[1], ...
            //      where a,b,c are each window's.
            // XXX: we should only do ...zero_part_begin for speed optimization.
            // do not touch for long area (long_band[<8] = short_band[<3] = samples[<36]) if switch_point.
            const sampfreq = sampling_frequencies[frame.header.sampling_frequency]; // all are same if [0] or [3].
            const band_short_indices = scalefactor_band_indices_short[sampfreq];
            const band_short_lengths = subbands_short_lengths[sampfreq];
            const bandFrom = frame.sideinfo.channel[ch].granule[gr].switch_point ? 3 : 0;
            const reordered = requantized_gr_ch.samples.slice(0, band_short_indices[bandFrom]); // this is copy longs if switch_point, else just [].
            for (const band of range(bandFrom, 13)) {
                const len = band_short_lengths[band];
                for (const i of times(len)) {
                    for (const window of times(3)) {
                        reordered.push(requantized_gr_ch.samples[band_short_indices[band] * 3 + window * len + i]);
                    }
                }
            }
            channel.push({ samples: reordered });
        }

        granule.push({ channel });
    }

    return {
        granule,
    };
}
export type Reordered = ReturnType<typeof reorder>;

function intensityRatio(scalefac: number) {
    if (scalefac === 7) {
        return null; // no intensity stereo
    }

    // 0=right...3=center...6=left, almost looks like linear though...
    if (scalefac === 6) {
        // "tan((6*PI)/12 = PI/2) needs special treatment!" from Lagerstrom MP3 Thesis.
        return [1.0, 0.0];
    } else {
        const ratio = Math.tan(scalefac * Math.PI / 12);
        return [
            ratio / (1 + ratio),
            1 / (1 + ratio),
        ];
    }
}

function intensityLongTill(gr: number, frame: Frame, maindata_gr: Maindata["granule"][number], channel: { samples: number[]; }[], till: number) {
    const sampfreq = sampling_frequencies[frame.header.sampling_frequency]; // all are same if [0] or [3].
    const processedChannel: { samples: number[]; }[] = times(2, () => ({ samples: [] }));

    // using channel0(left) scalefac to calculate.
    const scalefac = maindata_gr.channel[0].scalefac;
    if (scalefac.type === "short") {
        throw new Error("BadImpl: intensityLongTill but passed short");
    }
    // to simplify long-block, we append zero for very last of scalefac-band.
    const scalefac_l = scalefac.scalefac_l.concat([0]);

    for (const band of times(till)) {
        const index = scalefactor_band_indices_long[sampfreq][band];
        const len = subbands_long_lengths[sampfreq][band];

        // using channel1(right) zero_part_begin to identify intensity-stereo band or not.
        if (index < maindata_gr.channel[1].is.zero_part_begin) {
            // not intensity-stereo part yet.
            processedChannel[0].samples.push(...channel[0].samples.slice(index, index + len));
            processedChannel[1].samples.push(...channel[1].samples.slice(index, index + len));
            continue;
        }

        const ratio = intensityRatio(scalefac_l[band]);
        if (!ratio) {
            // not intensity-stereo enabled band.
            processedChannel[0].samples.push(...channel[0].samples.slice(index, index + len));
            processedChannel[1].samples.push(...channel[1].samples.slice(index, index + len));
            continue;
        }

        const [left, right] = ratio;
        for (const i of times(len)) {
            // also using channel0(left) "is" to calculate.
            const intensity = channel[0].samples[index + i];
            processedChannel[0].samples.push(intensity * left);
            processedChannel[1].samples.push(intensity * right);
        }
    }

    return processedChannel;
}

// note: return is from "from", not from "0", to make easier to concat() later.
// note: Lagerstrom MP3 Thesis's intensity stereo short code has a bug: not multiplying but just assigned...
function intensityShortFrom(gr: number, frame: Frame, maindata_gr: Maindata["granule"][number], stereosamples: { samples: number[]; }[], from: number) {
    const sampfreq = sampling_frequencies[frame.header.sampling_frequency]; // all are same if [0] or [3].
    const processedChannel: { samples: number[]; }[] = times(2, () => ({ samples: [] }));

    // using channel0(left) scalefac to calculate.
    const scalefac = maindata_gr.channel[0].scalefac;
    if (scalefac.type === "long") {
        throw new Error("BadImpl: intensityShortFrom but passed long");
    }
    // to simplify, we append zero(s per window) for very last of scalefac-band.
    const scalefac_s = scalefac.scalefac_s.concat([[0, 0, 0]]);

    for (const band of range(from, 13)) {
        const index = scalefactor_band_indices_short[sampfreq][band] * 3;
        const len = subbands_short_lengths[sampfreq][band];

        // using channel1(right) zero_part_begin to intensity-stereo band or not.
        if (index < maindata_gr.channel[1].is.zero_part_begin) {
            // not intensity-stereo part yet.
            processedChannel[0].samples.push(...stereosamples[0].samples.slice(index, index + len * 3));
            processedChannel[1].samples.push(...stereosamples[1].samples.slice(index, index + len * 3));
            continue;
        }

        for (const window of times(3)) {
            const ratio = intensityRatio(scalefac_s[band][window]);
            if (!ratio) {
                // not intensity-stereo enabled band.
                processedChannel[0].samples.push(...stereosamples[0].samples.slice(index, index + len));
                processedChannel[1].samples.push(...stereosamples[1].samples.slice(index, index + len));
                continue;
            }

            // from Lagerstrom MP3 Thesis. but it is reordered to a0,b0,c0,a1,b1,c1,a2,... ??
            const index_win = index + len * window;
            const [left, right] = ratio;
            for (const i of times(len)) {
                // also using channel0(left) "is" to calculate.
                const intensity = stereosamples[0].samples[index_win + i];
                processedChannel[0].samples.push(intensity * left);
                processedChannel[1].samples.push(intensity * right);
            }
        }
    }

    return processedChannel;
}

// Intensity Stereo processing is complecated because of different factors for long and short * 3...
function intensitystereo(gr: number, frame: Frame, maindata_gr: Maindata["granule"][number], stereosamples: { samples: number[]; }[]) {
    const type = maindata_gr.channel[0].scalefac.type;
    switch (type) {
        case "long": { // sideinfo.block_type !== 2
            return intensityLongTill(gr, frame, maindata_gr, stereosamples, 22);
        }
        case "short": { // sideinfo.switch_point === 0
            return intensityShortFrom(gr, frame, maindata_gr, stereosamples, 0);
        }
        case "mixed": { // else (block_type === 2 && switch_point === 1)
            const [longl, longr] = intensityLongTill(gr, frame, maindata_gr, stereosamples, 8);
            const [shortl, shortr] = intensityShortFrom(gr, frame, maindata_gr, stereosamples, 3);
            return [
                { samples: longl.samples.concat(shortl.samples) },
                { samples: longr.samples.concat(shortr.samples) }
            ];
        }
        default:
            throw new Error(`bad scalefac.type: ${type}`);
    }
}

function jointstereo(frame: Frame, maindata: Maindata, reordered: ReturnType<typeof reorder>) {
    if (frame.header.mode !== 1 || frame.header.mode_extension === 0) {
        // not joint-stereo or both MS and IS are NOT used. do nothing.
        return reordered;
    }

    const inv_sqrt2 = 1 / Math.sqrt(2);

    const granule = [];
    for (const gr of times(2)) {
        let channel = reordered.granule[gr].channel;
        // Middle-Side stereo processing.
        if ((frame.header.mode_extension & 2) !== 0) {
            const max_pos = Math.max(...times(2).map(ch => maindata.granule[gr].channel[ch].is.zero_part_begin));
            const ms: number[][] = [[], []];
            for (const i of times(max_pos)) {
                ms[0].push((channel[0].samples[i] + channel[1].samples[i]) * inv_sqrt2);
                ms[1].push((channel[0].samples[i] - channel[1].samples[i]) * inv_sqrt2);
            }
            // copy tail as is.
            for (const i of range(max_pos, 576)) {
                ms[0].push(channel[0].samples[i]);
                ms[1].push(channel[1].samples[i]);
            }
            channel = ms.map(samples => ({ samples }));
        }

        // Intensity stereo processing.
        if ((frame.header.mode_extension & 1) !== 0) {
            channel = intensitystereo(gr, frame, maindata.granule[gr], channel);
        }

        granule.push({
            channel,
        });
    }

    return {
        granule,
    };
}
export type Stereoed = ReturnType<typeof jointstereo>;

const antiAliasCoeffs = [-0.6, -0.535, -0.33, -0.185, -0.095, -0.041, -0.0142, -0.0037];
// ??? magic!
const antiAliasS = antiAliasCoeffs.map(coeff => 1 / Math.sqrt(1 + coeff * coeff)); // Signal?
const antiAliasA = antiAliasCoeffs.map(coeff => coeff / Math.sqrt(1 + coeff * coeff)); // Alias?
function antialias(frame: Frame, stereoed: ReturnType<typeof jointstereo>) {
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const granule = [];
    for (const gr of times(2)) {
        const channel = [];
        for (const ch of times(nchans)) {
            const samples = stereoed.granule[gr].channel[ch].samples;
            const sideinfo = frame.sideinfo.channel[ch].granule[gr];
            // antialias is only for long-blocks
            if (sideinfo.block_type === 2 && sideinfo.switch_point === 0) {
                channel.push({ samples });
                continue;
            }

            // note: antialias is work with equally-18-width 32-subbands (for filterbank), not oddly scalefac-bands.
            const till_sb = (sideinfo.block_type === 2) ? 2 : 32; // if block_type===2 then switch_point===1.
            const work = [...samples.slice(0, 18 * till_sb)]; // copy
            // "butterfly calculations" from Lagerstrom MP3 Thesis.
            // area overlaps, overwriting "work" is easier than functional style.
            for (const sb of range(1, till_sb)) {
                for (const i of times(8)) {
                    const loweri = 18 * sb - 1 - i;
                    const upperi = 18 * sb + i;
                    const lowersamp = work[loweri] * antiAliasS[i] - work[upperi] * antiAliasA[i];
                    const uppersamp = work[upperi] * antiAliasS[i] + work[loweri] * antiAliasA[i];
                    work[loweri] = lowersamp;
                    work[upperi] = uppersamp;
                }
            }
            channel.push({ samples: work.concat(samples.slice(18 * till_sb)) });
        }

        granule.push({ channel });
    }

    return {
        granule,
    };
}
export type Antialised = ReturnType<typeof antialias>;

function imdct(src: number[]) {
    const n_half = src.length;
    const n = n_half * 2;
    return times(n).map(p => {
        const xs = src.map((e, m) => e * Math.cos(Math.PI / (2 * n) * (2 * p + 1 + n_half) * (2 * m + 1)));
        const sum = xs.reduce((prev, cur) => prev + cur, 0);
        return sum;
    });
}

const imdct_windows = [
    // block_type 0: normal long block
    times(36).map(i => Math.sin(Math.PI / 36 * (i + 0.5))),
    // block_type 1: start long block
    ([] as number[]).concat(
        range(0, 18).map(i => Math.sin(Math.PI / 36 * (i + 0.5))),
        Array(24 - 18).fill(1),
        range(24, 30).map(i => Math.sin(Math.PI / 12 * (i - 18 + 0.5))),
        Array(36 - 30).fill(0),
    ),
    // block_type 2: 3 short block (only 12 elements)
    times(12).map(i => Math.sin(Math.PI / 12 * (i + 0.5))),
    // block_type 3: end long block
    ([] as number[]).concat(
        Array(6).fill(0),
        range(6, 12).map(i => Math.sin(Math.PI / 12 * (i - 6 + 0.5))),
        Array(18 - 12).fill(1),
        range(18, 36).map(i => Math.sin(Math.PI / 36 * (i + 0.5))),
    ),
];

function imdct_win(src: number[], block_type: number) {
    if (block_type !== 2) {
        // longs
        const timedom = imdct(src);
        return timedom.map((e, i) => e * imdct_windows[block_type][i]);
    } else {
        // short: pad 0 to head and tail, and overlap 3 blocks here, to make caller overlaps easier.
        // TODO: can't be simpler more?
        const timedom_ws = times(3).map(window => imdct(range(window, 18, 3).map(i => src[i]))); // using trick: range start is already offsetted.
        const shaped_ws = timedom_ws.map(timedom => timedom.map((e, i) => e * imdct_windows[2][i]));
        const lapped: number[] = Array(36).fill(0);
        shaped_ws.forEach((shaped, window) => {
            shaped.forEach((e, i) => {
                lapped[(1 + window) * 6 + i] += e;
            });
        });
        return lapped;
    }
}

type SubbandsType = {
    channel: {
        subband: number[][];
    }[];
};

function hybridsynth(frame: Frame, rawprevtail: SubbandsType | null, antialiased: ReturnType<typeof antialias>) {
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;
    let prevtail = rawprevtail || { channel: times(nchans).map(_ => ({ subband: times(32).map(_ => Array(18).fill(0) as number[]) })) };

    const granule: NonNullable<SubbandsType>[] = [];
    for (const gr of times(2)) {
        const channel: NonNullable<SubbandsType>["channel"] = [];
        const tail_ch = [];
        for (const ch of times(nchans)) {
            const samples = antialiased.granule[gr].channel[ch].samples;
            const sideinfo = frame.sideinfo.channel[ch].granule[gr];
            const is_mixed_block = sideinfo.block_type === 2 && sideinfo.switch_point === 1;
            const subband: NonNullable<SubbandsType>["channel"][number]["subband"] = [];
            const tail_sb = [];
            for (const sb of times(32)) {
                // fake block_type=0(normal) if mixed_block and sb < 2 (even-point in subbands).
                // technique taken from Lagerstrom MP3 Thesis.
                const btype = (is_mixed_block && sb < 2) ? 0 : sideinfo.block_type;
                const timedom = imdct_win(samples.slice(18 * sb, 18 * (sb + 1)), btype);
                const head = timedom.slice(0, 18);
                const tail = timedom.slice(18);
                // prev and current(timedom) are already windowed, just add to mix.
                // don't forget to pick only first-half (18/36).
                const mixed = head.map((e, i) => e + prevtail.channel[ch].subband[sb][i]);  // eslint-disable-line no-loop-func

                subband.push(mixed);
                tail_sb.push(tail);
            }

            channel.push({ subband });
            tail_ch.push({ subband: tail_sb });
        }

        granule.push({ channel });
        prevtail = { channel: tail_ch };
    }

    return {
        granule,

        prevtail,
    };
}
export type Hybridsynthed = ReturnType<typeof hybridsynth>;

function freqinv(hybridsynthed: { granule: ReturnType<typeof hybridsynth>["granule"]; }) {
    return {
        granule: hybridsynthed.granule.map(gr => ({
            channel: gr.channel.map(ch => ({
                // for each odd 32[subbands] * 18[samples/subband], inverse value on odd-index.
                // ex. sb[1][1,3,5,...,17], sb[3][1,3,5,...,17], ...
                subband: ch.subband.map((sb, sb_i) =>
                    sb.map((s, i) => ((sb_i % 2) === 1 && (i % 2) === 1) ? -s : s)
                ),
            })),
        })),
    };
}
export type Freqinved = ReturnType<typeof freqinv>;

// magical table D[]...
// its exact expr is unknown as of 2020-07-25. https://staff.fnwi.uva.nl/t.h.koornwinder/art/misc/hemker.pdf
const synth_tab_d = [
    0.000000000, -0.000015259, -0.000015259, -0.000015259,
    -0.000015259, -0.000015259, -0.000015259, -0.000030518,
    -0.000030518, -0.000030518, -0.000030518, -0.000045776,
    -0.000045776, -0.000061035, -0.000061035, -0.000076294,
    -0.000076294, -0.000091553, -0.000106812, -0.000106812,
    -0.000122070, -0.000137329, -0.000152588, -0.000167847,
    -0.000198364, -0.000213623, -0.000244141, -0.000259399,
    -0.000289917, -0.000320435, -0.000366211, -0.000396729,
    -0.000442505, -0.000473022, -0.000534058, -0.000579834,
    -0.000625610, -0.000686646, -0.000747681, -0.000808716,
    -0.000885010, -0.000961304, -0.001037598, -0.001113892,
    -0.001205444, -0.001296997, -0.001388550, -0.001480103,
    -0.001586914, -0.001693726, -0.001785278, -0.001907349,
    -0.002014160, -0.002120972, -0.002243042, -0.002349854,
    -0.002456665, -0.002578735, -0.002685547, -0.002792358,
    -0.002899170, -0.002990723, -0.003082275, -0.003173828,
    0.003250122, 0.003326416, 0.003387451, 0.003433228,
    0.003463745, 0.003479004, 0.003479004, 0.003463745,
    0.003417969, 0.003372192, 0.003280640, 0.003173828,
    0.003051758, 0.002883911, 0.002700806, 0.002487183,
    0.002227783, 0.001937866, 0.001617432, 0.001266479,
    0.000869751, 0.000442505, -0.000030518, -0.000549316,
    -0.001098633, -0.001693726, -0.002334595, -0.003005981,
    -0.003723145, -0.004486084, -0.005294800, -0.006118774,
    -0.007003784, -0.007919312, -0.008865356, -0.009841919,
    -0.010848999, -0.011886597, -0.012939453, -0.014022827,
    -0.015121460, -0.016235352, -0.017349243, -0.018463135,
    -0.019577026, -0.020690918, -0.021789551, -0.022857666,
    -0.023910522, -0.024932861, -0.025909424, -0.026840210,
    -0.027725220, -0.028533936, -0.029281616, -0.029937744,
    -0.030532837, -0.031005859, -0.031387329, -0.031661987,
    -0.031814575, -0.031845093, -0.031738281, -0.031478882,
    0.031082153, 0.030517578, 0.029785156, 0.028884888,
    0.027801514, 0.026535034, 0.025085449, 0.023422241,
    0.021575928, 0.019531250, 0.017257690, 0.014801025,
    0.012115479, 0.009231567, 0.006134033, 0.002822876,
    -0.000686646, -0.004394531, -0.008316040, -0.012420654,
    -0.016708374, -0.021179199, -0.025817871, -0.030609131,
    -0.035552979, -0.040634155, -0.045837402, -0.051132202,
    -0.056533813, -0.061996460, -0.067520142, -0.073059082,
    -0.078628540, -0.084182739, -0.089706421, -0.095169067,
    -0.100540161, -0.105819702, -0.110946655, -0.115921021,
    -0.120697021, -0.125259399, -0.129562378, -0.133590698,
    -0.137298584, -0.140670776, -0.143676758, -0.146255493,
    -0.148422241, -0.150115967, -0.151306152, -0.151962280,
    -0.152069092, -0.151596069, -0.150497437, -0.148773193,
    -0.146362305, -0.143264771, -0.139450073, -0.134887695,
    -0.129577637, -0.123474121, -0.116577148, -0.108856201,
    0.100311279, 0.090927124, 0.080688477, 0.069595337,
    0.057617188, 0.044784546, 0.031082153, 0.016510010,
    0.001068115, -0.015228271, -0.032379150, -0.050354004,
    -0.069168091, -0.088775635, -0.109161377, -0.130310059,
    -0.152206421, -0.174789429, -0.198059082, -0.221984863,
    -0.246505737, -0.271591187, -0.297210693, -0.323318481,
    -0.349868774, -0.376800537, -0.404083252, -0.431655884,
    -0.459472656, -0.487472534, -0.515609741, -0.543823242,
    -0.572036743, -0.600219727, -0.628295898, -0.656219482,
    -0.683914185, -0.711318970, -0.738372803, -0.765029907,
    -0.791213989, -0.816864014, -0.841949463, -0.866363525,
    -0.890090942, -0.913055420, -0.935195923, -0.956481934,
    -0.976852417, -0.996246338, -1.014617920, -1.031936646,
    -1.048156738, -1.063217163, -1.077117920, -1.089782715,
    -1.101211548, -1.111373901, -1.120223999, -1.127746582,
    -1.133926392, -1.138763428, -1.142211914, -1.144287109,
    1.144989014, 1.144287109, 1.142211914, 1.138763428,
    1.133926392, 1.127746582, 1.120223999, 1.111373901,
    1.101211548, 1.089782715, 1.077117920, 1.063217163,
    1.048156738, 1.031936646, 1.014617920, 0.996246338,
    0.976852417, 0.956481934, 0.935195923, 0.913055420,
    0.890090942, 0.866363525, 0.841949463, 0.816864014,
    0.791213989, 0.765029907, 0.738372803, 0.711318970,
    0.683914185, 0.656219482, 0.628295898, 0.600219727,
    0.572036743, 0.543823242, 0.515609741, 0.487472534,
    0.459472656, 0.431655884, 0.404083252, 0.376800537,
    0.349868774, 0.323318481, 0.297210693, 0.271591187,
    0.246505737, 0.221984863, 0.198059082, 0.174789429,
    0.152206421, 0.130310059, 0.109161377, 0.088775635,
    0.069168091, 0.050354004, 0.032379150, 0.015228271,
    -0.001068115, -0.016510010, -0.031082153, -0.044784546,
    -0.057617188, -0.069595337, -0.080688477, -0.090927124,
    0.100311279, 0.108856201, 0.116577148, 0.123474121,
    0.129577637, 0.134887695, 0.139450073, 0.143264771,
    0.146362305, 0.148773193, 0.150497437, 0.151596069,
    0.152069092, 0.151962280, 0.151306152, 0.150115967,
    0.148422241, 0.146255493, 0.143676758, 0.140670776,
    0.137298584, 0.133590698, 0.129562378, 0.125259399,
    0.120697021, 0.115921021, 0.110946655, 0.105819702,
    0.100540161, 0.095169067, 0.089706421, 0.084182739,
    0.078628540, 0.073059082, 0.067520142, 0.061996460,
    0.056533813, 0.051132202, 0.045837402, 0.040634155,
    0.035552979, 0.030609131, 0.025817871, 0.021179199,
    0.016708374, 0.012420654, 0.008316040, 0.004394531,
    0.000686646, -0.002822876, -0.006134033, -0.009231567,
    -0.012115479, -0.014801025, -0.017257690, -0.019531250,
    -0.021575928, -0.023422241, -0.025085449, -0.026535034,
    -0.027801514, -0.028884888, -0.029785156, -0.030517578,
    0.031082153, 0.031478882, 0.031738281, 0.031845093,
    0.031814575, 0.031661987, 0.031387329, 0.031005859,
    0.030532837, 0.029937744, 0.029281616, 0.028533936,
    0.027725220, 0.026840210, 0.025909424, 0.024932861,
    0.023910522, 0.022857666, 0.021789551, 0.020690918,
    0.019577026, 0.018463135, 0.017349243, 0.016235352,
    0.015121460, 0.014022827, 0.012939453, 0.011886597,
    0.010848999, 0.009841919, 0.008865356, 0.007919312,
    0.007003784, 0.006118774, 0.005294800, 0.004486084,
    0.003723145, 0.003005981, 0.002334595, 0.001693726,
    0.001098633, 0.000549316, 0.000030518, -0.000442505,
    -0.000869751, -0.001266479, -0.001617432, -0.001937866,
    -0.002227783, -0.002487183, -0.002700806, -0.002883911,
    -0.003051758, -0.003173828, -0.003280640, -0.003372192,
    -0.003417969, -0.003463745, -0.003479004, -0.003479004,
    -0.003463745, -0.003433228, -0.003387451, -0.003326416,
    0.003250122, 0.003173828, 0.003082275, 0.002990723,
    0.002899170, 0.002792358, 0.002685547, 0.002578735,
    0.002456665, 0.002349854, 0.002243042, 0.002120972,
    0.002014160, 0.001907349, 0.001785278, 0.001693726,
    0.001586914, 0.001480103, 0.001388550, 0.001296997,
    0.001205444, 0.001113892, 0.001037598, 0.000961304,
    0.000885010, 0.000808716, 0.000747681, 0.000686646,
    0.000625610, 0.000579834, 0.000534058, 0.000473022,
    0.000442505, 0.000396729, 0.000366211, 0.000320435,
    0.000289917, 0.000259399, 0.000244141, 0.000213623,
    0.000198364, 0.000167847, 0.000152588, 0.000137329,
    0.000122070, 0.000106812, 0.000106812, 0.000091553,
    0.000076294, 0.000076294, 0.000061035, 0.000061035,
    0.000045776, 0.000045776, 0.000030518, 0.000030518,
    0.000030518, 0.000030518, 0.000015259, 0.000015259,
    0.000015259, 0.000015259, 0.000015259, 0.000015259,
];
// synth_filter: applied at subband_samples -> V (matrixing)
// matrixing is... Lagerstrom MP3 Thesis says "a variant of IMDCT".
// not to confuse with hybridsynth(IMDCT+window+mix), that is another IMDCT.
// you may ask "why make table here but not other?" ...just because.
const synth_filter = times(64, i => times(32, j => Math.cos((16 + i) * (2 * j + 1) * Math.PI / 64)));
type VVecQType = {
    channel: number[][][];
};
function subbandsynth(frame: Frame, raw_prev_v_vec_q: VVecQType | null, freqinved: ReturnType<typeof freqinv>, bandmask: boolean[]) {
    const is_mono = frame.header.mode === 3;
    const nchans = is_mono ? 1 : 2;

    const prev_v_vec_q = raw_prev_v_vec_q || { channel: times(2, _ => times(16, _ => Array(64).fill(0))) };
    const v_vec_q_chs = [...prev_v_vec_q.channel];
    const channel: number[][] = [];
    for (const ch of times(nchans)) {
        const gr_out: number[] = [];
        for (const gr of times(2)) {
            for (const ss of times(18)) { // Subband Sample
                // yes, collect each subband's sample[ss]. seems odd.
                const s_vec = times(32, i => freqinved.granule[gr].channel[ch].subband[i][ss]);
                // matrixing. v_vec looks actually [2][32] but here [64] as concatenated...
                const v_vec = times(64, i => times(32, j => bandmask[j] ? s_vec[j] * synth_filter[i][j] : 0).reduce((prev, cur) => prev + cur, 0));

                v_vec_q_chs[ch] = [v_vec, ...v_vec_q_chs[ch].slice(0, 15)];

                // u_vec: constructed by pick each [0][0][0..31] and [1][1][0..31] in each [2].
                // in current structure, it is [0][0..31] and [1][32..63].
                const u_vec = range(0, 16, 2).flatMap(i => v_vec_q_chs[ch][i].slice(0, 32).concat(v_vec_q_chs[ch][i + 1].slice(32)));

                // windowed
                const w_vec = u_vec.map((e, i) => e * synth_tab_d[i]);

                // get final samples by sum by columnar
                const out = times(32, i => times(16, j => w_vec[j * 32 + i]).reduce((prev, cur) => prev + cur, 0));
                gr_out.push(...out);
            }
        }
        channel.push(gr_out);
    }

    return {
        channel,

        v_vec_q: { channel: v_vec_q_chs },
    };
}
export type Subbandsynthed = ReturnType<typeof subbandsynth>["channel"];

function decodeframe(prev_v_vec_q: VVecQType | null, prevsound: SubbandsType | null, frame: Frame, maindata: Maindata, bandmask: boolean[]) {
    // requantize, reorder and stereo, in "scalefactor band" world...
    const requantized = requantize(frame, maindata);
    const reordered = reorder(frame, requantized);
    const stereoed = jointstereo(frame, maindata, reordered);

    // filterbanks, in "equally-18-width band" world...
    const antialiased = antialias(frame, stereoed);
    // IMDCT, windowing and overlap adding are called "hybrid filter bank"
    const hysynthed_timedom = hybridsynth(frame, prevsound, antialiased);
    const freqinved = freqinv(hysynthed_timedom);
    const sbsynthed = subbandsynth(frame, prev_v_vec_q, freqinved, bandmask);

    return {
        channel: sbsynthed.channel,

        // last granule to feed into next hybridsynth, it must be before freqinved (in decode).
        lastHybridTail: hysynthed_timedom.prevtail,
        v_vec_q: sbsynthed.v_vec_q,

        internal: { requantized, reordered, stereoed, antialiased, hysynthed_timedom, freqinved, sbsynthed, },
    };
}
export type Internal = ReturnType<typeof decodeframe>["internal"];

export async function parsefile(ab: ArrayBuffer, callback: (iter: {
    i: number,
    frame: Frame,
    maindata?: Maindata,
    soundframe?: Subbandsynthed,
    internal?: Internal;
}) => Promise<boolean> = async () => true, rawBandmask: boolean[] | null = null) {
    const bandmask = rawBandmask || (Array(32).fill(true) as boolean[]);
    const br = new U8BitReader(new Uint8Array(ab));
    const frames = [];
    const maindatas = [];
    const soundframes = [];
    const internals = [];
    let prevHybridTail: SubbandsType | null = null;
    let prevVVecQ: VVecQType | null = null;
    while (!br.eof()) {
        if (!br.findbyte(0xFF)) {
            break;
        }
        const pos = br.tell();
        try {
            const frame = await readframe(br);
            frames.push(frame);
            try {
                // recent 2 frames and current... in spec.
                // XXX: main_data pointing more than 2 frames ago in the wild. feed 511 bytes that is max-value of main_data_end.
                //      we cannot (511 / (frame_bytes(frame.header) - 4 - 31)) because of VBR.
                // XXX: not supporting free-format yet...
                const prevFrames = [];
                let prevFrameMainDataLen = 0;
                // [frames.length - 1] = last = just appended. exclude it...
                for (let i = frames.length - 2; 0 <= i; i--) {
                    prevFrames.unshift(frames[i]);
                    prevFrameMainDataLen += frames[i].data.length;
                    if (511 <= prevFrameMainDataLen) {
                        break;
                    }
                }
                const framedata = await unpackframe(prevFrames, frame);
                if (framedata) {
                    maindatas.push(framedata);

                    const { channel: sound, lastHybridTail, v_vec_q, internal } = decodeframe(prevVVecQ, prevHybridTail, frame, framedata, bandmask);
                    prevHybridTail = lastHybridTail;
                    prevVVecQ = v_vec_q;
                    soundframes.push(sound);
                    internals.push(internal);
                    const cont = await callback({ i: frames.length - 1, frame, maindata: framedata, soundframe: sound, internal });
                    if (!cont) {
                        break;
                    }
                } else {
                    // not enough reservoir
                    const cont = await callback({ i: frames.length - 1, frame });
                    if (!cont) {
                        break;
                    }
                }
            } catch{
                // so broken maindata or bug in our code; ignore for main_data decoding

                const cont = await callback({ i: frames.length - 1, frame });
                if (!cont) {
                    break;
                }
            }
        } catch {
            // try next byte, synchronizing to byte
            br.seek(Math.floor(pos / 8 + 1) * 8);
        }
    }
    return {
        frames,
        maindatas,
        soundframes,
        internals,
    };
}

import { parsefile, PromiseType, Frame, Maindata, Internal } from './libmp3';

export type Frameref = {
    main_i: number;
    maindata: Maindata;
    granule: number;
    channel: number;
    part: "scalefac" | "huffman";
    offset: number;
    size: number;
};

export type ParsedFrame = {
    frame: Frame;
    maindata?: Maindata;
    internal?: Internal;
    framerefs: Frameref[];
};

export type MyParsed = {
    sounds: number[][];
    parsedFrames: ParsedFrame[];
};

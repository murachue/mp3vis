import React from 'react';

export function Zoombar<T>({ width, height, barHeight, zoomWidth, drawWhole, drawZoom, zooming, data, onPointerDown, onPointerUp, ...props }: {
    width: string | number;
    height: string | number;
    barHeight: number;
    zoomWidth: number;
    drawWhole: (ctx: CanvasRenderingContext2D, width: number, height: number, data: T) => void;
    drawZoom: (ctx: CanvasRenderingContext2D, offset: number, width: number, height: number, data: T) => void;
    zooming: boolean;
    data: T;
} & JSX.IntrinsicElements["canvas"]) {
    const refCanvas = React.createRef<HTMLCanvasElement>();

    const [mousepos, setMousepos] = React.useState<[number, number]>([0, 0]);

    React.useEffect(() => {
        const canvas = refCanvas.current;

        if (!canvas) {
            return;
        }

        // https://stackoverflow.com/a/10214971
        const cw = canvas.width = canvas.offsetWidth;
        const ch = canvas.height = canvas.offsetHeight;

        const ctx = canvas.getContext("2d")!;

        // seems not required...
        // ctx.clearRect(0, 0, cw, ch);

        ctx.save();
        ctx.translate(0, (ch - barHeight) / 2);
        ctx.beginPath();
        ctx.rect(0, 0, cw + 1, barHeight + 1);
        ctx.clip();
        drawWhole(ctx, cw, barHeight, data);
        ctx.restore();

        if (zooming) {
            const mx = Math.max(0, Math.min(mousepos[0], cw));
            const wx = Math.max(0, Math.min(mx - zoomWidth / 2, cw - zoomWidth));

            ctx.save();
            ctx.translate(wx, 0);
            ctx.beginPath();
            ctx.rect(0, 0, zoomWidth + 1, ch + 1);
            ctx.clip();
            drawZoom(ctx, mx / cw, zoomWidth, ch, data);
            ctx.restore();
        }
    });

    // const enterMove = function (e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    //     const canvas = refCanvas.current;
    //     const container = canvas?.parentElement?.parentElement;
    //     if (container) {
    //         setMousepos([e.clientX - container.offsetLeft, e.clientY]);
    //     }
    // };

    // const leave = function (e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    //     setMousepos(null);
    // };

    // return (<div style={{ width, position: "relative" }}>
    //     <div style={{ width: "100%", height: 40 }} onMouseOver={enterMove} onMouseOut={leave} onMouseMove={enterMove}>
    //         <canvas width="1" height={30} ref={refCanvas} style={{ width: "100%", height: 30, position: "relative", top: "50%", transform: "translateY(-50%)" }} />
    //     </div>
    //     <div style={{ display: mousepos ? "block" : "none", width: 200, height: 40, position: "absolute", left: mousepos ? mousepos[0] : 0, top: 0, border: "1px solid red", background: "white" }}></div>
    // </div>);

    const enterMove = function (e: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        const canvas = refCanvas.current;
        if (canvas) {
            setMousepos([e.clientX - canvas.offsetLeft, e.clientY - canvas.offsetTop]);
        }
    };

    const leave = function (e: React.MouseEvent<HTMLCanvasElement, MouseEvent>) {
        // setMousepos(null);
    };

    return (<canvas {...props} width="1" height="1" ref={refCanvas} style={{ width, height }} onMouseOver={enterMove} onMouseOut={leave} onMouseMove={enterMove} onPointerDown={(e: any) => { e.target.setPointerCapture(e.pointerId); onPointerDown?.(e); }} onPointerUp={(e: any) => { e.target.releasePointerCapture(e.pointerId); onPointerUp?.(e); }} />);
}

import React from 'react';

export function Zoombar({ width }: { width: string | number; }) {
    const refCanvas = React.createRef<HTMLCanvasElement>();

    const [mousepos, setMousepos] = React.useState<[number, number] | null>(null);

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

        ctx.fillStyle = "black";
        ctx.fillRect(0, 5, cw, ch - 10);

        ctx.strokeStyle = "white";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(100, 20);
        ctx.stroke();

        if (mousepos) {
            ctx.strokeStyle = "red";
            ctx.beginPath();
            ctx.moveTo(mousepos[0] + 0.5, 0 + 0.5);
            ctx.lineTo(mousepos[0] + 0.5, ch + 0.5);
            ctx.stroke();
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
        setMousepos(null);
    };

    return (<canvas width="1" height={40} ref={refCanvas} style={{ width, height: 40 }} onMouseOver={enterMove} onMouseOut={leave} onMouseMove={enterMove} />);
}

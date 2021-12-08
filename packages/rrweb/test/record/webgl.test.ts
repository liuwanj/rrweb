/* tslint:disable no-console */

import * as fs from 'fs';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import {
  recordOptions,
  listenerHandler,
  eventWithTime,
  EventType,
  IncrementalSource,
  styleSheetRuleData,
  CanvasContext,
} from '../../src/types';
import { assertSnapshot, launchPuppeteer } from '../utils';
import { OgmentedCanvas } from '../../src/record/observers/canvas/canvas';

interface ISuite {
  code: string;
  browser: puppeteer.Browser;
  page: puppeteer.Page;
  events: eventWithTime[];
}

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
    addCustomEvent<T>(tag: string, payload: T): void;
  };
  emit: (e: eventWithTime) => undefined;
}

const setup = function (this: ISuite, content: string): ISuite {
  const ctx = {} as ISuite;

  beforeAll(async () => {
    ctx.browser = await launchPuppeteer();

    const bundlePath = path.resolve(__dirname, '../../dist/rrweb.min.js');
    ctx.code = fs.readFileSync(bundlePath, 'utf8');
  });

  beforeEach(async () => {
    ctx.page = await ctx.browser.newPage();
    await ctx.page.goto('about:blank');
    await ctx.page.setContent(content);
    await ctx.page.evaluate(ctx.code);
    ctx.events = [];
    await ctx.page.exposeFunction('emit', (e: eventWithTime) => {
      if (e.type === EventType.DomContentLoaded || e.type === EventType.Load) {
        return;
      }
      ctx.events.push(e);
    });

    ctx.page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  });

  afterEach(async () => {
    await ctx.page.close();
  });

  afterAll(async () => {
    await ctx.browser.close();
  });

  return ctx;
};

describe('record webgl', function (this: ISuite) {
  jest.setTimeout(100_000);

  const ctx: ISuite = setup.call(
    this,
    `
      <!DOCTYPE html>
      <html>
        <body>
          <canvas id="canvas"></canvas>
        </body>
      </html>
    `,
  );

  it('will record changes to a canvas element', async () => {
    await ctx.page.evaluate(() => {
      const { record } = ((window as unknown) as IWindow).rrweb;
      record({
        recordCanvas: true,
        emit(event: eventWithTime) {
          ((window as unknown) as IWindow).emit(event);
        },
      });
    });
    await ctx.page.evaluate(() => {
      var canvas = document.getElementById('canvas') as HTMLCanvasElement;
      var gl = canvas.getContext('webgl')!;

      gl.clear(gl.COLOR_BUFFER_BIT);
    });

    await ctx.page.waitForTimeout(50);

    const lastEvent = ctx.events[ctx.events.length - 1];
    expect(lastEvent).toMatchObject({
      data: {
        source: IncrementalSource.CanvasMutation,
        args: [16384],
        type: CanvasContext.WebGL,
        property: 'clear',
      },
    });
  });

  it('will record changes to a canvas element before the canvas gets added', async () => {
    await ctx.page.evaluate(() => {
      const { record } = ((window as unknown) as IWindow).rrweb;
      record({
        recordCanvas: true,
        emit: ((window as unknown) as IWindow).emit,
      });
    });
    await ctx.page.evaluate(() => {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl')!;
      var program = gl.createProgram()!;
      gl.linkProgram(program);
      gl.clear(gl.COLOR_BUFFER_BIT);
      document.body.appendChild(canvas);
    });

    await ctx.page.waitForTimeout(50);

    const lastEvent = ctx.events[ctx.events.length - 1];
    expect(lastEvent).toMatchObject({
      data: {
        source: IncrementalSource.CanvasMutation,
        type: CanvasContext.WebGL,
        property: 'clear',
      },
    });
    // TODO: make this a jest snapshot
  });

  it('will record webgl variables', async () => {
    await ctx.page.evaluate(() => {
      const { record } = ((window as unknown) as IWindow).rrweb;
      record({
        recordCanvas: true,
        emit: ((window as unknown) as IWindow).emit,
      });
    });
    await ctx.page.evaluate(() => {
      var canvas = document.getElementById('canvas') as HTMLCanvasElement;
      var gl = canvas.getContext('webgl')!;
      var program0 = gl.createProgram()!;
      gl.linkProgram(program0);
      var program1 = gl.createProgram()!;
      gl.linkProgram(program1);
    });

    await ctx.page.waitForTimeout(50);

    const lastEvent = ctx.events[ctx.events.length - 1];
    expect(lastEvent).toMatchObject({
      data: {
        source: IncrementalSource.CanvasMutation,
        property: 'linkProgram',
        type: CanvasContext.WebGL,
        args: [
          {
            index: 1,
            rr_type: 'WebGLProgram',
          },
        ], // `program1` is WebGLProgram, this is the second WebGLProgram variable (index #1)
      },
    });
  });

  it('sets _context on canvas.getContext()', async () => {
    await ctx.page.evaluate(() => {
      const { record } = ((window as unknown) as IWindow).rrweb;
      record({
        recordCanvas: true,
        emit: ((window as unknown) as IWindow).emit,
      });
    });
    const context = await ctx.page.evaluate(() => {
      var canvas = document.getElementById('canvas') as HTMLCanvasElement;
      canvas.getContext('webgl')!;
      return (canvas as OgmentedCanvas).__context;
    });

    expect(context).toBe('webgl');
  });

  it('only sets _context on first canvas.getContext() call', async () => {
    await ctx.page.evaluate(() => {
      const { record } = ((window as unknown) as IWindow).rrweb;
      record({
        recordCanvas: true,
        emit: ((window as unknown) as IWindow).emit,
      });
    });
    const context = await ctx.page.evaluate(() => {
      var canvas = document.getElementById('canvas') as HTMLCanvasElement;
      canvas.getContext('webgl');
      canvas.getContext('2d'); // returns null
      return (canvas as OgmentedCanvas).__context;
    });

    expect(context).toBe('webgl');
  });
});
export interface BlockGap {
  expectedHeight: number;
  receivedHeight: number;
  missingHeights: number[];
}

export class BlockGapDetector {
  public constructor(private lastContiguousHeight: number) {
    if (!Number.isSafeInteger(lastContiguousHeight) || lastContiguousHeight < 0) {
      throw new RangeError("Checkpoint height must be a non-negative safe integer");
    }
  }

  public get checkpoint(): number {
    return this.lastContiguousHeight;
  }

  public inspect(receivedHeight: number): BlockGap | null {
    if (!Number.isSafeInteger(receivedHeight) || receivedHeight <= this.lastContiguousHeight) {
      return null;
    }
    const expectedHeight = this.lastContiguousHeight + 1;
    if (receivedHeight === expectedHeight) return null;
    return {
      expectedHeight,
      receivedHeight,
      missingHeights: Array.from(
        { length: receivedHeight - expectedHeight },
        (_, index) => expectedHeight + index
      ),
    };
  }

  public commit(height: number): void {
    if (height !== this.lastContiguousHeight + 1) {
      throw new Error(`Cannot commit non-contiguous block ${height}; expected ${this.lastContiguousHeight + 1}`);
    }
    this.lastContiguousHeight = height;
  }
}

import {
  readVisibleGroupSlugs,
  saveVisibleGroupSlugs,
  updateQueryGroupFields,
} from "./parameter-display-config";

describe("parameter display configuration", () => {
  afterEach(() => localStorage.clear());

  it("stores and reads display group selections independently", () => {
    saveVisibleGroupSlugs(1, ["region", "store"]);

    expect(readVisibleGroupSlugs(1)).toEqual(["region", "store"]);
  });

  it("appends selected groups to select and group by with commas", () => {
    expect(
      updateQueryGroupFields(
        "SELECT date, SUM(amount) FROM sales GROUP BY date",
        [],
        ["store", "product"],
        { store: "门店", product: "商品" },
      ),
    ).toBe(
      'SELECT date, SUM(amount), store "门店", product "商品" FROM sales GROUP BY date, store, product',
    );
  });

  it("removes group fields when they are unchecked", () => {
    expect(
      updateQueryGroupFields(
        "SELECT date, store FROM sales GROUP BY date, store",
        ["store"],
        [],
      ),
    ).toBe("SELECT date FROM sales GROUP BY date");
  });
});

import { groupArray } from "../utils";

test("The array group function should work", () => {
  const test1 = [1, 2, 3];
  const test2 = [1, 2, 3, 4];

  const testGrouped1 = groupArray(test1, 1);
  console.log({ testGrouped1 });
  expect(testGrouped1).toEqual([[1], [2], [3]]);

  const testGrouped2 = groupArray(test1, 2);
  console.log({ testGrouped2 });
  expect(testGrouped2).toEqual([[1, 2], [3]]);

  const testGrouped3 = groupArray(test1, 3);
  console.log({ testGrouped3 });
  expect(testGrouped3).toEqual([[1, 2, 3]]);

  const testGrouped4 = groupArray(test1, 4);
  console.log(testGrouped4);
  expect(testGrouped4).toEqual([[1, 2, 3]]);

  const testGrouped5 = groupArray(test2, 1);
  console.log(testGrouped5);
  expect(testGrouped5).toEqual([[1], [2], [3], [4]]);

  const testGrouped6 = groupArray(test2, 2);
  console.log(testGrouped6);
  expect(testGrouped6).toEqual([
    [1, 2],
    [3, 4],
  ]);

  const testGrouped7 = groupArray(test2, 3);
  console.log(testGrouped7);
  expect(testGrouped7).toEqual([[1, 2, 3], [4]]);

  const testGrouped8 = groupArray(test2, 4);
  console.log(testGrouped8);
  expect(testGrouped8).toEqual([[1, 2, 3, 4]]);
});

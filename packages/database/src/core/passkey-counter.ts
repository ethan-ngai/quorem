import { customType } from 'drizzle-orm/pg-core';

const maximum = 0xffff_ffff;
function checked(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError('Invalid WebAuthn signature counter');
  return value;
}

export const passkeyCounter = customType<{ data: number; driverData: string }>({
  dataType: () => 'bigint',
  fromDriver: value => checked(Number(value)),
  toDriver: value => String(checked(value)),
});

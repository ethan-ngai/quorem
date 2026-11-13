"""Measure Python instruction counts on a shared corpus using CPython 3.12+."""

import json
import sys


def linear(values):
    total = 0
    for value in values:
        total += value
    return total


def quadratic(values):
    total = 0
    for left in values:
        for right in values:
            total += left == right
    return total


def builtin_sort(values):
    return sorted(values)


def instructions(function, values):
    monitoring = sys.monitoring
    tool = monitoring.PROFILER_ID
    event = monitoring.events.INSTRUCTION
    count = 0

    def on_instruction(_code, _offset):
        nonlocal count
        count += 1

    monitoring.use_tool_id(tool, "quorem-work-calibration")
    monitoring.register_callback(tool, event, on_instruction)
    monitoring.set_local_events(tool, function.__code__, event)
    try:
        function(values)
    finally:
        monitoring.set_local_events(tool, function.__code__, 0)
        monitoring.register_callback(tool, event, None)
        monitoring.free_tool_id(tool)
    return count


def main():
    rows = []
    for size in (16, 64, 256):
        values = [(index * 193) % 257 for index in range(size)]
        for function in (linear, quadratic, builtin_sort):
            counts = [instructions(function, values) for _ in range(3)]
            rows.append({"operation": function.__name__, "size": size, "counts": counts})
    print(json.dumps({"runtime": sys.version.split()[0], "measurements": rows}, indent=2))


if __name__ == "__main__":
    main()

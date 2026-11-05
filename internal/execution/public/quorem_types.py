from __future__ import annotations

from typing import Generic, TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import TypeVar

    T = TypeVar("T", default=int)
else:
    from typing import TypeVar

    T = TypeVar("T")


class ListNode(Generic[T]):
    def __init__(
        self,
        val: T = 0,  # type: ignore[assignment]
        next: ListNode[T] | None = None,
    ) -> None:
        self.val = val
        self.next = next


class TreeNode(Generic[T]):
    def __init__(
        self,
        val: T = 0,  # type: ignore[assignment]
        left: TreeNode[T] | None = None,
        right: TreeNode[T] | None = None,
    ) -> None:
        self.val = val
        self.left = left
        self.right = right


class NaryTreeNode(Generic[T]):
    def __init__(self, val: T = 0, children: list[NaryTreeNode[T]] | None = None) -> None:  # type: ignore[assignment]
        self.val = val
        self.children = [] if children is None else children

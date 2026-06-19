---
id: know-binary-search
scope: project
category: project_knowledge
source_session: user-request
updated_at: 2026-06-18T16:30:00.000Z

---

# Python 二分法实现

## 标准实现（迭代）

```python
def binary_search(arr, target):
    """在有序数组 arr 中查找 target，返回索引，未找到返回 -1"""
    left, right = 0, len(arr) - 1

    while left <= right:
        mid = left + (right - left) // 2   # 取中间索引，防溢出

        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1

    return -1
```

## 递归版本

```python
def binary_search_recursive(arr, target, left, right):
    if left > right:
        return -1

    mid = left + (right - left) // 2

    if arr[mid] == target:
        return mid
    elif arr[mid] < target:
        return binary_search_recursive(arr, target, mid + 1, right)
    else:
        return binary_search_recursive(arr, target, left, mid - 1)
```

## 关键要点

- **数组必须有序**，否则结果不可靠
- 时间复杂度 `O(log n)`，空间复杂度迭代 `O(1)`、递归 `O(log n)`
- 生产环境推荐用 Python 标准库 `bisect`：`bisect.bisect_left(arr, target)`
- 中间值计算用 `left + (right - left) // 2` 避免大数组溢出

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getProduct } from '../api/products'

const CART_KEY = 'cart'
const CartContext = createContext(null)
export const useCart = () => useContext(CartContext)

const load = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const clamp = (qty, stock) => Math.max(1, Math.min(Math.floor(Number(qty)) || 1, stock))

export function CartProvider({ children }) {
  const [items, setItems] = useState(load)

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(items))
  }, [items])

  // On load: drop archived/missing products and cap quantities at current stock.
  useEffect(() => {
    const stored = load()
    if (!stored.length) return
    let active = true
    Promise.all(
      stored.map((item) =>
        getProduct(item.productId)
          .then((p) =>
            p.archived || p.stock < 1
              ? null
              : { ...item, name: p.name, price: p.price, image: p.images[0]?.url, stock: p.stock, quantity: clamp(item.quantity, p.stock) },
          )
          .catch((e) => (e.status === 404 ? null : item)),
      ),
    ).then((fresh) => active && setItems(fresh.filter(Boolean)))
    return () => {
      active = false
    }
  }, [])

  const add = useCallback((product, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id)
      if (existing) {
        return prev.map((i) =>
          i === existing ? { ...i, stock: product.stock, quantity: clamp(i.quantity + quantity, product.stock) } : i,
        )
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: product.price,
          image: product.images?.[0]?.url,
          stock: product.stock,
          quantity: clamp(quantity, product.stock),
        },
      ]
    })
  }, [])

  const setQuantity = useCallback(
    (productId, quantity) =>
      setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, quantity: clamp(quantity, i.stock) } : i))),
    [],
  )
  const remove = useCallback((productId) => setItems((prev) => prev.filter((i) => i.productId !== productId)), [])
  const clear = useCallback(() => setItems([]), [])

  // conflicts: [{productId, available}] from a 409 — cap quantities, drop sold-out items
  const adjustToAvailability = useCallback(
    (conflicts) =>
      setItems((prev) =>
        prev
          .map((i) => {
            const c = conflicts.find((x) => x.productId === String(i.productId))
            if (!c) return i
            return { ...i, stock: c.available, quantity: Math.min(i.quantity, c.available) }
          })
          .filter((i) => i.quantity > 0),
      ),
    [],
  )

  const value = useMemo(
    () => ({
      items,
      count: items.reduce((n, i) => n + i.quantity, 0),
      total: items.reduce((n, i) => n + i.quantity * i.price, 0),
      add,
      setQuantity,
      remove,
      clear,
      adjustToAvailability,
    }),
    [items, add, setQuantity, remove, clear, adjustToAvailability],
  )
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

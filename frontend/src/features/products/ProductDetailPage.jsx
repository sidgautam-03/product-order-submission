import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getProduct } from '../../api/products'
import DataState from '../../components/DataState'
import StarRating from '../../components/StarRating'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import { useAsync } from '../../hooks/useAsync'
import { money } from '../../utils/format'
import ReviewSection from './ReviewSection'

export default function ProductDetailPage() {
  const { id } = useParams()
  const { isAdmin } = useAuth()
  const { add } = useCart()
  const { data: product, loading, error, reload } = useAsync((signal) => getProduct(id, signal), [id])
  const [qty, setQty] = useState(1)
  const [activeImage, setActiveImage] = useState(0)
  const [added, setAdded] = useState(false)

  return (
    <DataState loading={loading} error={error} hasData={Boolean(product)} onRetry={reload}>
      {product && (
        <>
          <div className="detail">
            <div>
              {product.images.length ? (
                <>
                  <img className="hero" src={product.images[activeImage]?.url ?? product.images[0].url} alt={product.name} />
                  <div className="thumbs">
                    {product.images.map((img, i) => (
                      <button key={img.id} type="button" onClick={() => setActiveImage(i)} aria-label={`Show image ${i + 1}`}>
                        <img src={img.url} alt="" />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="no-image hero">No image</div>
              )}
            </div>
            <div>
              <h1>{product.name}</h1>
              <p>
                <StarRating value={product.rating} /> <span className="muted">{product.rating.toFixed(1)} ({product.reviewCount} reviews)</span>
              </p>
              <p className="price">{money(product.price)}</p>
              <p className="muted">{product.category}</p>
              <p>{product.description}</p>
              <p>{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</p>

              {isAdmin ? (
                <Link to={`/admin/products/${product.id}/edit`}>Edit product</Link>
              ) : (
                product.stock > 0 &&
                !product.archived && (
                  <div className="row">
                    <label>
                      Quantity{' '}
                      <input
                        type="number"
                        min="1"
                        max={product.stock}
                        value={qty}
                        onChange={(e) => setQty(Math.max(1, Math.min(product.stock, Math.floor(Number(e.target.value)) || 1)))}
                      />
                    </label>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        add(product, qty)
                        setAdded(true)
                      }}
                    >
                      Add to cart
                    </button>
                  </div>
                )
              )}
              {added && (
                <p className="success" role="status">
                  Added to cart. <Link to="/cart">View cart</Link>
                </p>
              )}
            </div>
          </div>
          <ReviewSection productId={id} onReviewed={reload} />
        </>
      )}
    </DataState>
  )
}

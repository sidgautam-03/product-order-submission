import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { archiveProduct, getProduct, saveProduct } from '../../api/products'
import ConfirmDialog from '../../components/ConfirmDialog'
import DataState from '../../components/DataState'
import FormField from '../../components/FormField'
import { useAsync } from '../../hooks/useAsync'

const MIN_IMAGES = 1
const MAX_IMAGES = 5
const MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function validateProduct(v, imageCount) {
  const errs = {}
  const name = v.name.trim()
  if (name.length < 2 || name.length > 120) errs.name = 'Name must be 2-120 characters'
  if (v.description.length > 2000) errs.description = 'Description must be at most 2000 characters'
  if (v.price === '' || !(Number(v.price) > 0)) errs.price = 'Price must be greater than 0'
  if (v.stock === '' || !Number.isInteger(Number(v.stock)) || Number(v.stock) < 0) errs.stock = 'Stock must be a whole number, 0 or more'
  if (!v.category.trim()) errs.category = 'Category is required'
  if (imageCount < MIN_IMAGES || imageCount > MAX_IMAGES) errs.images = `A product needs ${MIN_IMAGES} to ${MAX_IMAGES} images`
  return errs
}

function ProductForm({ product }) {
  const navigate = useNavigate()
  const isEdit = Boolean(product)
  const [values, setValues] = useState({
    name: product?.name ?? '',
    description: product?.description ?? '',
    price: product ? String(product.price) : '',
    stock: product ? String(product.stock) : '',
    category: product?.category ?? '',
  })
  const [existing, setExisting] = useState(product?.images ?? [])
  const [removed, setRemoved] = useState([])
  const [added, setAdded] = useState([]) // [{ file, preview }]
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const addedRef = useRef(added)
  addedRef.current = added

  useEffect(() => () => addedRef.current.forEach((a) => URL.revokeObjectURL(a.preview)), [])

  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }))
  const imageCount = existing.length + added.length

  const onFiles = (e) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    const problems = []
    const ok = []
    picked.forEach((file) => {
      if (!ALLOWED_TYPES.includes(file.type)) problems.push(`${file.name}: only JPG, PNG or WebP images are allowed`)
      else if (file.size > MAX_FILE_BYTES) problems.push(`${file.name}: larger than 5 MB`)
      else ok.push(file)
    })
    const room = MAX_IMAGES - imageCount
    if (ok.length > room) problems.push(`Only ${MAX_IMAGES} images are allowed per product`)
    setAdded((prev) => [...prev, ...ok.slice(0, Math.max(room, 0)).map((file) => ({ file, preview: URL.createObjectURL(file) }))])
    setErrors((prev) => ({ ...prev, images: problems.join('. ') || undefined }))
  }

  const removeExisting = (img) => {
    setExisting((prev) => prev.filter((i) => i.id !== img.id))
    setRemoved((prev) => [...prev, img.id])
  }
  const removeAdded = (a) => {
    URL.revokeObjectURL(a.preview)
    setAdded((prev) => prev.filter((x) => x !== a))
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    const errs = validateProduct(values, imageCount)
    setErrors(errs)
    setFormError('')
    if (Object.keys(errs).length) return

    const body = new FormData()
    body.append('name', values.name.trim())
    body.append('description', values.description)
    body.append('price', values.price)
    body.append('stock', values.stock)
    body.append('category', values.category.trim())
    removed.forEach((id) => body.append('removeImageIds', id))
    added.forEach((a) => body.append('images', a.file))

    setSubmitting(true)
    try {
      const saved = await saveProduct(product?.id, body)
      navigate(`/products/${saved.id ?? product.id}`)
    } catch (err) {
      setErrors(err.fieldErrors ?? {})
      setFormError(err.message)
      setSubmitting(false)
    }
  }

  const onArchive = async () => {
    setArchiving(true)
    try {
      await archiveProduct(product.id)
      navigate('/')
    } catch (err) {
      setFormError(err.message)
      setConfirmOpen(false)
      setArchiving(false)
    }
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      <h1>{isEdit ? 'Edit product' : 'New product'}</h1>
      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}
      <FormField label="Name" error={errors.name}>
        <input value={values.name} onChange={set('name')} />
      </FormField>
      <FormField label="Description" error={errors.description}>
        <textarea rows={4} value={values.description} onChange={set('description')} />
      </FormField>
      <div className="row">
        <FormField label="Price" error={errors.price}>
          <input type="number" step="0.01" min="0" value={values.price} onChange={set('price')} />
        </FormField>
        <FormField label="Stock" error={errors.stock}>
          <input type="number" step="1" min="0" value={values.stock} onChange={set('stock')} />
        </FormField>
        <FormField label="Category" error={errors.category}>
          <input value={values.category} onChange={set('category')} />
        </FormField>
      </div>

      <fieldset>
        <legend>
          Images ({imageCount}/{MAX_IMAGES})
        </legend>
        <div className="thumbs">
          {existing.map((img) => (
            <figure key={img.id}>
              <img src={img.url} alt="Existing product" />
              <button type="button" onClick={() => removeExisting(img)}>
                Remove
              </button>
            </figure>
          ))}
          {added.map((a) => (
            <figure key={a.preview}>
              <img src={a.preview} alt={`Preview of ${a.file.name}`} />
              <button type="button" onClick={() => removeAdded(a)}>
                Remove
              </button>
            </figure>
          ))}
        </div>
        <input type="file" accept={ALLOWED_TYPES.join(',')} multiple onChange={onFiles} aria-label="Add images" disabled={imageCount >= MAX_IMAGES} />
        {errors.images && (
          <span className="field-error" role="alert">
            {errors.images}
          </span>
        )}
      </fieldset>

      <div className="row">
        <button type="submit" className="primary" disabled={submitting || archiving}>
          {submitting ? 'Saving…' : 'Save product'}
        </button>
        {isEdit && (
          <button type="button" className="danger" disabled={submitting || archiving} onClick={() => setConfirmOpen(true)}>
            Archive
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Archive product?"
        message="Archived products are hidden from customers and removed from carts."
        confirmLabel="Archive"
        busy={archiving}
        onConfirm={onArchive}
        onCancel={() => setConfirmOpen(false)}
      />
    </form>
  )
}

export default function ProductFormPage() {
  const { id } = useParams()
  const { data, loading, error, reload } = useAsync((signal) => (id ? getProduct(id, signal) : Promise.resolve(null)), [id])
  return (
    <DataState loading={loading} error={error} hasData={id ? Boolean(data) : true} onRetry={reload}>
      <ProductForm key={id ?? 'new'} product={data} />
    </DataState>
  )
}

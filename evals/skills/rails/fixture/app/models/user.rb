class User < ApplicationRecord
  has_many :accounts, dependent: :destroy

  validates :name, presence: true
  validates :email, presence: true, uniqueness: true

  scope :with_accounts, -> { includes(:accounts) }
end
